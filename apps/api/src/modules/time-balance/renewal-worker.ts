import { createPublicDb, createTenantDb, tenants } from '@payroll/db'
import { and, eq } from 'drizzle-orm'
import { getRenewalState, runRenewalCycle } from './renewal-service'

type TimerHandle = ReturnType<typeof setInterval>

// One renewal worker per tenant.
type RenewalEntry = { tenantSlug: string; timer: TimerHandle }
const renewalWorkers = new Map<string, RenewalEntry>()

function key(tenantSlug: string) {
  return `renewal:${tenantSlug}`
}

export function startRenewalWorker(
  tenantSlug: string,
  intervalMinutes: number,
  databaseUrl: string
) {
  const k = key(tenantSlug)
  const existing = renewalWorkers.get(k)
  if (existing) clearInterval(existing.timer)

  const db = createTenantDb(tenantSlug, databaseUrl)
  const tick = async () => {
    try {
      await runRenewalCycle(db)
    } catch (err) {
      console.error(`[time-balance-renewal] ${k}:`, err instanceof Error ? err.message : err)
    }
  }

  // Run once shortly after start so a missed renewal is caught up immediately.
  void tick()
  const timer = setInterval(tick, intervalMinutes * 60 * 1000)
  renewalWorkers.set(k, { tenantSlug, timer })
}

export function stopRenewalWorker(tenantSlug: string) {
  const k = key(tenantSlug)
  const entry = renewalWorkers.get(k)
  if (entry) {
    clearInterval(entry.timer)
    renewalWorkers.delete(k)
  }
}

export function isRenewalRunning(tenantSlug: string): boolean {
  return renewalWorkers.has(key(tenantSlug))
}

/**
 * On server start, resume renewal workers for tenants whose state has
 * auto_start = true and status = 'running'.
 */
export async function bootstrapRenewalWorkers(databaseUrl: string) {
  const publicDb = createPublicDb(databaseUrl)
  const activeTenants = await publicDb
    .select({ slug: tenants.slug })
    .from(tenants)
    .where(and(eq(tenants.status, 'ACTIVE'), eq(tenants.isActive, true)))

  for (const tenant of activeTenants) {
    try {
      const db = createTenantDb(tenant.slug, databaseUrl)
      const state = await getRenewalState(db)
      if (state?.autoStart && state.status === 'running') {
        startRenewalWorker(tenant.slug, state.intervalMinutes as number, databaseUrl)
      }
    } catch (err) {
      console.error(
        `[time-balance-renewal] bootstrap ${tenant.slug}:`,
        err instanceof Error ? err.message : err
      )
    }
  }
}
