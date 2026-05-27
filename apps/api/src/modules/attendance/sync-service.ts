import { attendancePunches, attendanceSyncLog, attendanceSyncState } from '@payroll/db'
import { and, desc, eq, gt, sql } from 'drizzle-orm'
import { consolidateDate } from './consolidation-service'

// biome-ignore lint/suspicious/noExplicitAny: drizzle generic
type AnyDb = any

export async function getSyncState(db: AnyDb, deviceId: string) {
  const [row] = await db
    .select()
    .from(attendanceSyncState)
    .where(eq(attendanceSyncState.deviceId, deviceId))
    .limit(1)
  return row ?? null
}

export async function listSyncStates(db: AnyDb) {
  return db.select().from(attendanceSyncState).orderBy(attendanceSyncState.createdAt)
}

export async function upsertSyncState(
  db: AnyDb,
  deviceId: string,
  patch: {
    status?: string
    intervalMinutes?: number
    autoStart?: boolean
  }
) {
  const existing = await getSyncState(db, deviceId)

  if (existing) {
    const set: Record<string, unknown> = { updatedAt: new Date() }
    if (patch.status !== undefined) set.status = patch.status
    if (patch.intervalMinutes !== undefined) set.intervalMinutes = patch.intervalMinutes
    if (patch.autoStart !== undefined) set.autoStart = patch.autoStart
    await db.update(attendanceSyncState).set(set).where(eq(attendanceSyncState.id, existing.id))
    return { ...(existing as Record<string, unknown>), ...set }
  }

  const [row] = await db
    .insert(attendanceSyncState)
    .values({
      deviceId,
      status: patch.status ?? 'stopped',
      intervalMinutes: patch.intervalMinutes ?? 15,
      autoStart: patch.autoStart ?? false,
    })
    .returning()
  return row
}

export async function listSyncLog(db: AnyDb, deviceId: string, limit = 50) {
  return db
    .select()
    .from(attendanceSyncLog)
    .where(eq(attendanceSyncLog.deviceId, deviceId))
    .orderBy(desc(attendanceSyncLog.createdAt))
    .limit(Math.min(limit, 200))
}

export type SyncCycleResult = {
  punchesFound: number
  punchesConsolidated: number
  daysAffected: number
  highWaterBefore: number
  highWaterAfter: number
  error?: string
}

export async function runSyncCycle(db: AnyDb, deviceId: string): Promise<SyncCycleResult> {
  const state = await getSyncState(db, deviceId)
  const hwm = state?.highWaterMark ?? 0
  const startedAt = new Date()

  const newPunches = await db
    .select({
      id: attendancePunches.id,
      employeeId: attendancePunches.employeeId,
      punchedAt: attendancePunches.punchedAt,
    })
    .from(attendancePunches)
    .where(and(eq(attendancePunches.deviceId, deviceId), gt(attendancePunches.id, hwm)))
    .orderBy(attendancePunches.id)

  if (newPunches.length === 0) {
    const logEntry = {
      deviceId,
      startedAt,
      finishedAt: new Date(),
      status: 'success',
      punchesFound: 0,
      punchesConsolidated: 0,
      daysAffected: 0,
      highWaterBefore: hwm,
      highWaterAfter: hwm,
    }
    await db.insert(attendanceSyncLog).values(logEntry)
    await db
      .update(attendanceSyncState)
      .set({
        lastRunAt: new Date(),
        lastSuccessAt: new Date(),
        lastError: null,
        updatedAt: new Date(),
      })
      .where(eq(attendanceSyncState.deviceId, deviceId))
    return { ...logEntry, highWaterBefore: hwm, highWaterAfter: hwm }
  }

  const affectedDates = new Set<string>()
  for (const p of newPunches as Array<{ punchedAt: Date }>) {
    const date = p.punchedAt.toISOString().slice(0, 10)
    affectedDates.add(date)
  }

  let consolidated = 0
  let consolidateErrors = 0
  const errors: string[] = []

  for (const date of affectedDates) {
    try {
      const result = await consolidateDate(db, date)
      consolidated += result.processed
      if (result.errors.length > 0) {
        errors.push(...result.errors.slice(0, 5))
      }
    } catch (err) {
      consolidateErrors++
      errors.push(err instanceof Error ? err.message : String(err))
    }
  }

  const maxId = Math.max(...(newPunches as Array<{ id: number }>).map((p) => p.id))
  const finishedAt = new Date()
  const finalStatus = consolidateErrors > 0 ? 'partial' : 'success'

  await db
    .update(attendanceSyncState)
    .set({
      highWaterMark: maxId,
      lastRunAt: finishedAt,
      lastSuccessAt: finalStatus === 'success' ? finishedAt : undefined,
      lastError: errors.length > 0 ? errors.join('; ').slice(0, 2000) : null,
      punchesSynced: sql`${attendanceSyncState.punchesSynced} + ${newPunches.length}`,
      daysConsolidated: sql`${attendanceSyncState.daysConsolidated} + ${affectedDates.size}`,
      updatedAt: finishedAt,
    })
    .where(eq(attendanceSyncState.deviceId, deviceId))

  const logEntry = {
    deviceId,
    startedAt,
    finishedAt,
    status: finalStatus,
    punchesFound: newPunches.length,
    punchesConsolidated: consolidated,
    daysAffected: affectedDates.size,
    highWaterBefore: hwm,
    highWaterAfter: maxId,
    errorMessage: errors.length > 0 ? errors.join('; ').slice(0, 2000) : null,
  }
  await db.insert(attendanceSyncLog).values(logEntry)

  return {
    punchesFound: newPunches.length,
    punchesConsolidated: consolidated,
    daysAffected: affectedDates.size,
    highWaterBefore: hwm,
    highWaterAfter: maxId,
    error: errors.length > 0 ? errors.join('; ').slice(0, 2000) : undefined,
  }
}
