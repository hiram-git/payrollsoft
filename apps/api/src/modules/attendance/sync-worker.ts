import {
  attendanceConsolidationState,
  attendanceIngestionState,
  createPublicDb,
  createTenantDb,
  tenants,
} from '@payroll/db'
import { and, eq } from 'drizzle-orm'
import { runIngestionCycle } from './ingestion-service'
import { runConsolidationCycle } from './sync-service'

type TimerHandle = ReturnType<typeof setInterval>

// ── Ingestion workers (one per tenant+device) ───────────────────────────────

type IngestionEntry = { tenantSlug: string; deviceId: string; timer: TimerHandle }
const ingestionWorkers = new Map<string, IngestionEntry>()

function ingestionKey(tenantSlug: string, deviceId: string) {
  return `ing:${tenantSlug}:${deviceId}`
}

export function startIngestionWorker(
  tenantSlug: string,
  deviceId: string,
  intervalMinutes: number,
  databaseUrl: string
) {
  const key = ingestionKey(tenantSlug, deviceId)
  const existing = ingestionWorkers.get(key)
  if (existing) clearInterval(existing.timer)

  const db = createTenantDb(tenantSlug, databaseUrl)
  const tick = async () => {
    try {
      await runIngestionCycle(db, deviceId)
    } catch (err) {
      console.error(`[ingestion] ${key}:`, err instanceof Error ? err.message : err)
    }
  }

  const timer = setInterval(tick, intervalMinutes * 60 * 1000)
  ingestionWorkers.set(key, { tenantSlug, deviceId, timer })
}

export function stopIngestionWorker(tenantSlug: string, deviceId: string) {
  const key = ingestionKey(tenantSlug, deviceId)
  const entry = ingestionWorkers.get(key)
  if (entry) {
    clearInterval(entry.timer)
    ingestionWorkers.delete(key)
  }
}

export function isIngestionRunning(tenantSlug: string, deviceId: string): boolean {
  return ingestionWorkers.has(ingestionKey(tenantSlug, deviceId))
}

// ── Consolidation workers (one per tenant) ──────────────────────────────────

type ConsolidationEntry = { tenantSlug: string; timer: TimerHandle }
const consolidationWorkers = new Map<string, ConsolidationEntry>()

function consolidationKey(tenantSlug: string) {
  return `con:${tenantSlug}`
}

export function startConsolidationWorker(
  tenantSlug: string,
  intervalMinutes: number,
  databaseUrl: string
) {
  const key = consolidationKey(tenantSlug)
  const existing = consolidationWorkers.get(key)
  if (existing) clearInterval(existing.timer)

  const db = createTenantDb(tenantSlug, databaseUrl)
  const tick = async () => {
    try {
      await runConsolidationCycle(db)
    } catch (err) {
      console.error(`[consolidation] ${key}:`, err instanceof Error ? err.message : err)
    }
  }

  const timer = setInterval(tick, intervalMinutes * 60 * 1000)
  consolidationWorkers.set(key, { tenantSlug, timer })
}

export function stopConsolidationWorker(tenantSlug: string) {
  const key = consolidationKey(tenantSlug)
  const entry = consolidationWorkers.get(key)
  if (entry) {
    clearInterval(entry.timer)
    consolidationWorkers.delete(key)
  }
}

export function isConsolidationRunning(tenantSlug: string): boolean {
  return consolidationWorkers.has(consolidationKey(tenantSlug))
}

// ── Bootstrap on server start ───────────────────────────────────────────────

export async function bootstrapWorkers(databaseUrl: string) {
  const publicDb = createPublicDb(databaseUrl)
  const activeTenants = await publicDb
    .select({ slug: tenants.slug })
    .from(tenants)
    .where(and(eq(tenants.status, 'ACTIVE'), eq(tenants.isActive, true)))

  let ingestionStarted = 0
  let consolidationStarted = 0

  for (const tenant of activeTenants as Array<{ slug: string }>) {
    const tenantDb = createTenantDb(tenant.slug, databaseUrl)

    try {
      const ingestionConfigs = await tenantDb
        .select({
          deviceId: attendanceIngestionState.deviceId,
          intervalMinutes: attendanceIngestionState.intervalMinutes,
        })
        .from(attendanceIngestionState)
        .where(
          and(
            eq(attendanceIngestionState.autoStart, true),
            eq(attendanceIngestionState.status, 'running')
          )
        )

      for (const cfg of ingestionConfigs as Array<{ deviceId: string; intervalMinutes: number }>) {
        startIngestionWorker(tenant.slug, cfg.deviceId, cfg.intervalMinutes, databaseUrl)
        ingestionStarted++
      }
    } catch {
      /* migration not applied yet */
    }

    try {
      const [conState] = await tenantDb
        .select({
          intervalMinutes: attendanceConsolidationState.intervalMinutes,
          status: attendanceConsolidationState.status,
          autoStart: attendanceConsolidationState.autoStart,
        })
        .from(attendanceConsolidationState)
        .limit(1)

      if (conState?.autoStart && conState.status === 'running') {
        startConsolidationWorker(tenant.slug, conState.intervalMinutes as number, databaseUrl)
        consolidationStarted++
      }
    } catch {
      /* migration not applied yet */
    }
  }

  const total = ingestionStarted + consolidationStarted
  if (total > 0) {
    console.log(
      `[sync-worker] bootstrapped ${ingestionStarted} ingestion + ${consolidationStarted} consolidation worker(s)`
    )
  }
}
