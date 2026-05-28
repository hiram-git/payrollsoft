import {
  attendanceConsolidationLog,
  attendanceConsolidationState,
  attendancePunches,
} from '@payroll/db'
import { desc, eq, gt, sql } from 'drizzle-orm'
import { consolidateDate } from './consolidation-service'

// biome-ignore lint/suspicious/noExplicitAny: drizzle generic
type AnyDb = any

export async function getConsolidationState(db: AnyDb) {
  const [row] = await db.select().from(attendanceConsolidationState).limit(1)
  return row ?? null
}

export async function upsertConsolidationState(
  db: AnyDb,
  patch: { status?: string; intervalMinutes?: number; autoStart?: boolean }
) {
  const existing = await getConsolidationState(db)
  if (existing) {
    const set: Record<string, unknown> = { updatedAt: new Date() }
    if (patch.status !== undefined) set.status = patch.status
    if (patch.intervalMinutes !== undefined) set.intervalMinutes = patch.intervalMinutes
    if (patch.autoStart !== undefined) set.autoStart = patch.autoStart
    await db
      .update(attendanceConsolidationState)
      .set(set)
      .where(eq(attendanceConsolidationState.id, existing.id))
    return { ...(existing as Record<string, unknown>), ...set }
  }
  const [row] = await db
    .insert(attendanceConsolidationState)
    .values({
      status: patch.status ?? 'stopped',
      intervalMinutes: patch.intervalMinutes ?? 15,
      autoStart: patch.autoStart ?? false,
    })
    .returning()
  return row
}

export async function listConsolidationLog(db: AnyDb, limit = 50) {
  return db
    .select()
    .from(attendanceConsolidationLog)
    .orderBy(desc(attendanceConsolidationLog.createdAt))
    .limit(Math.min(limit, 200))
}

export type ConsolidationCycleResult = {
  punchesFound: number
  daysAffected: number
  employeesProcessed: number
  employeesAbsent: number
  highWaterBefore: number
  highWaterAfter: number
  error?: string
}

export async function runConsolidationCycle(db: AnyDb): Promise<ConsolidationCycleResult> {
  const state = await getConsolidationState(db)
  const hwm = (state?.highWaterMark as number) ?? 0
  const startedAt = new Date()

  const newPunches = await db
    .select({ id: attendancePunches.id, punchedAt: attendancePunches.punchedAt })
    .from(attendancePunches)
    .where(gt(attendancePunches.id, hwm))
    .orderBy(attendancePunches.id)

  if (newPunches.length === 0) {
    await db.insert(attendanceConsolidationLog).values({
      startedAt,
      finishedAt: new Date(),
      status: 'success',
      highWaterBefore: hwm,
      highWaterAfter: hwm,
    })
    await touchConsolidationRun(db)
    return {
      punchesFound: 0,
      daysAffected: 0,
      employeesProcessed: 0,
      employeesAbsent: 0,
      highWaterBefore: hwm,
      highWaterAfter: hwm,
    }
  }

  const affectedDates = new Set<string>()
  for (const p of newPunches as Array<{ punchedAt: Date }>) {
    affectedDates.add(p.punchedAt.toISOString().slice(0, 10))
  }

  let totalProcessed = 0
  let totalAbsent = 0
  let consolidateErrors = 0
  const errors: string[] = []

  for (const date of affectedDates) {
    try {
      const result = await consolidateDate(db, date)
      totalProcessed += result.processed
      totalAbsent += result.absent
      if (result.errors.length > 0) errors.push(...result.errors.slice(0, 5))
    } catch (err) {
      consolidateErrors++
      errors.push(err instanceof Error ? err.message : String(err))
    }
  }

  const maxId = Math.max(...(newPunches as Array<{ id: number }>).map((p) => p.id))
  const finishedAt = new Date()
  const finalStatus = consolidateErrors > 0 ? 'partial' : 'success'

  await db
    .update(attendanceConsolidationState)
    .set({
      highWaterMark: maxId,
      lastRunAt: finishedAt,
      lastSuccessAt: finalStatus === 'success' ? finishedAt : undefined,
      lastError: errors.length > 0 ? errors.join('; ').slice(0, 2000) : null,
      daysConsolidated: sql`${attendanceConsolidationState.daysConsolidated} + ${affectedDates.size}`,
      updatedAt: finishedAt,
    })
    .where(
      state
        ? eq(attendanceConsolidationState.id, (state as Record<string, unknown>).id as string)
        : sql`true`
    )

  await db.insert(attendanceConsolidationLog).values({
    startedAt,
    finishedAt,
    status: finalStatus,
    punchesFound: newPunches.length,
    daysAffected: affectedDates.size,
    employeesProcessed: totalProcessed,
    employeesAbsent: totalAbsent,
    highWaterBefore: hwm,
    highWaterAfter: maxId,
    errorMessage: errors.length > 0 ? errors.join('; ').slice(0, 2000) : null,
  })

  return {
    punchesFound: newPunches.length,
    daysAffected: affectedDates.size,
    employeesProcessed: totalProcessed,
    employeesAbsent: totalAbsent,
    highWaterBefore: hwm,
    highWaterAfter: maxId,
    error: errors.length > 0 ? errors.join('; ').slice(0, 2000) : undefined,
  }
}

async function touchConsolidationRun(db: AnyDb) {
  const now = new Date()
  const state = await getConsolidationState(db)
  if (state) {
    await db
      .update(attendanceConsolidationState)
      .set({ lastRunAt: now, lastSuccessAt: now, lastError: null, updatedAt: now })
      .where(eq(attendanceConsolidationState.id, (state as Record<string, unknown>).id as string))
  }
}
