import { attendanceSyncState, createPublicDb, createTenantDb, tenants } from '@payroll/db'
import { and, eq } from 'drizzle-orm'
import { runSyncCycle } from './sync-service'

type TimerHandle = ReturnType<typeof setInterval>

type WorkerEntry = {
  tenantSlug: string
  deviceId: string
  timer: TimerHandle
  intervalMinutes: number
}

const activeWorkers = new Map<string, WorkerEntry>()

function workerKey(tenantSlug: string, deviceId: string) {
  return `${tenantSlug}:${deviceId}`
}

export function startDeviceWorker(
  tenantSlug: string,
  deviceId: string,
  intervalMinutes: number,
  databaseUrl: string
) {
  const key = workerKey(tenantSlug, deviceId)
  const existing = activeWorkers.get(key)
  if (existing) {
    clearInterval(existing.timer)
  }

  const db = createTenantDb(tenantSlug, databaseUrl)

  const tick = async () => {
    try {
      await runSyncCycle(db, deviceId)
    } catch (err) {
      console.error(`[sync-worker] ${key} error:`, err instanceof Error ? err.message : err)
    }
  }

  const timer = setInterval(tick, intervalMinutes * 60 * 1000)
  activeWorkers.set(key, { tenantSlug, deviceId, timer, intervalMinutes })
}

export function stopDeviceWorker(tenantSlug: string, deviceId: string) {
  const key = workerKey(tenantSlug, deviceId)
  const entry = activeWorkers.get(key)
  if (entry) {
    clearInterval(entry.timer)
    activeWorkers.delete(key)
  }
}

export function isWorkerRunning(tenantSlug: string, deviceId: string): boolean {
  return activeWorkers.has(workerKey(tenantSlug, deviceId))
}

export function getActiveWorkerCount(): number {
  return activeWorkers.size
}

export async function bootstrapWorkers(databaseUrl: string) {
  const publicDb = createPublicDb(databaseUrl)

  const activeTenants = await publicDb
    .select({ slug: tenants.slug })
    .from(tenants)
    .where(and(eq(tenants.status, 'ACTIVE'), eq(tenants.isActive, true)))

  let started = 0

  for (const tenant of activeTenants as Array<{ slug: string }>) {
    const tenantDb = createTenantDb(tenant.slug, databaseUrl)

    try {
      const configs = await tenantDb
        .select({
          deviceId: attendanceSyncState.deviceId,
          intervalMinutes: attendanceSyncState.intervalMinutes,
          status: attendanceSyncState.status,
          autoStart: attendanceSyncState.autoStart,
        })
        .from(attendanceSyncState)
        .where(
          and(eq(attendanceSyncState.autoStart, true), eq(attendanceSyncState.status, 'running'))
        )

      for (const cfg of configs as Array<{
        deviceId: string
        intervalMinutes: number
        status: string
        autoStart: boolean
      }>) {
        startDeviceWorker(tenant.slug, cfg.deviceId, cfg.intervalMinutes, databaseUrl)
        started++
      }
    } catch {
      // tenant may not have the migration yet — skip silently
    }
  }

  if (started > 0) {
    console.log(`[sync-worker] bootstrapped ${started} device worker(s)`)
  }
}
