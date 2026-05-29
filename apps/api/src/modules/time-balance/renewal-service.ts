import { timeBalanceRenewalLog, timeBalanceRenewalState } from '@payroll/db'
import { desc, eq } from 'drizzle-orm'
import { initializeYearForAllEmployees } from './service'

// biome-ignore lint/suspicious/noExplicitAny: Drizzle db instance
type AnyDb = any

export async function getRenewalState(db: AnyDb) {
  const [row] = await db.select().from(timeBalanceRenewalState).limit(1)
  return row ?? null
}

export async function upsertRenewalState(
  db: AnyDb,
  patch: {
    status?: string
    intervalMinutes?: number
    runMonth?: number
    runDay?: number
    autoStart?: boolean
  }
) {
  const existing = await getRenewalState(db)
  if (existing) {
    const set: Record<string, unknown> = { updatedAt: new Date() }
    if (patch.status !== undefined) set.status = patch.status
    if (patch.intervalMinutes !== undefined) set.intervalMinutes = patch.intervalMinutes
    if (patch.runMonth !== undefined) set.runMonth = patch.runMonth
    if (patch.runDay !== undefined) set.runDay = patch.runDay
    if (patch.autoStart !== undefined) set.autoStart = patch.autoStart
    await db
      .update(timeBalanceRenewalState)
      .set(set)
      .where(eq(timeBalanceRenewalState.id, existing.id))
    return { ...(existing as Record<string, unknown>), ...set }
  }
  const [row] = await db
    .insert(timeBalanceRenewalState)
    .values({
      status: patch.status ?? 'stopped',
      intervalMinutes: patch.intervalMinutes ?? 1440,
      runMonth: patch.runMonth ?? 1,
      runDay: patch.runDay ?? 1,
      autoStart: patch.autoStart ?? false,
    })
    .returning()
  return row
}

export async function listRenewalLog(db: AnyDb, limit = 50) {
  return db
    .select()
    .from(timeBalanceRenewalLog)
    .orderBy(desc(timeBalanceRenewalLog.createdAt))
    .limit(Math.min(limit, 200))
}

export type RenewalCycleResult = {
  ran: boolean
  year: number
  employeesProcessed: number
  compensatoryCreated: number
  familyDisabilityCreated: number
  reason?: string
  error?: string
}

/**
 * One renewal tick. Opens the current year's balances when:
 *   - `force` is set (manual "run now"), OR
 *   - today's (month, day) has reached the configured (run_month, run_day)
 *     AND the year has not been renewed yet (last_renewed_year < currentYear).
 *
 * Idempotent: `initializeYearForAllEmployees` skips employees already
 * initialized, so re-running within the same year is safe.
 */
export async function runRenewalCycle(
  db: AnyDb,
  opts: { force?: boolean; performedBy?: string; trigger?: string } = {}
): Promise<RenewalCycleResult> {
  const state = await getRenewalState(db)
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth() + 1
  const day = now.getDate()

  const runMonth = (state?.runMonth as number) ?? 1
  const runDay = (state?.runDay as number) ?? 1
  const lastRenewedYear = (state?.lastRenewedYear as number | null) ?? null

  const dateReached = month > runMonth || (month === runMonth && day >= runDay)
  const alreadyRenewed = lastRenewedYear !== null && lastRenewedYear >= year

  if (!opts.force && (!dateReached || alreadyRenewed)) {
    await touchRenewalRun(db)
    return {
      ran: false,
      year,
      employeesProcessed: 0,
      compensatoryCreated: 0,
      familyDisabilityCreated: 0,
      reason: alreadyRenewed ? 'already_renewed' : 'date_not_reached',
    }
  }

  const startedAt = new Date()
  try {
    const result = await initializeYearForAllEmployees(db, year, opts.performedBy, 'annual_renewal')
    const finishedAt = new Date()

    if (state) {
      await db
        .update(timeBalanceRenewalState)
        .set({
          lastRenewedYear: year,
          lastRunAt: finishedAt,
          lastSuccessAt: finishedAt,
          lastError: null,
          yearsRenewed: (state.yearsRenewed as number) + 1,
          updatedAt: finishedAt,
        })
        .where(eq(timeBalanceRenewalState.id, state.id))
    }

    await db.insert(timeBalanceRenewalLog).values({
      startedAt,
      finishedAt,
      status: 'success',
      year,
      employeesProcessed: result.total,
      compensatoryCreated: result.compensatoryCreated,
      familyDisabilityCreated: result.familyDisabilityCreated,
      trigger: opts.trigger ?? 'worker',
    })

    return {
      ran: true,
      year,
      employeesProcessed: result.total,
      compensatoryCreated: result.compensatoryCreated,
      familyDisabilityCreated: result.familyDisabilityCreated,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const finishedAt = new Date()
    if (state) {
      await db
        .update(timeBalanceRenewalState)
        .set({ lastRunAt: finishedAt, lastError: message.slice(0, 2000), updatedAt: finishedAt })
        .where(eq(timeBalanceRenewalState.id, state.id))
    }
    await db.insert(timeBalanceRenewalLog).values({
      startedAt,
      finishedAt,
      status: 'error',
      year,
      trigger: opts.trigger ?? 'worker',
      errorMessage: message.slice(0, 2000),
    })
    return {
      ran: false,
      year,
      employeesProcessed: 0,
      compensatoryCreated: 0,
      familyDisabilityCreated: 0,
      error: message,
    }
  }
}

async function touchRenewalRun(db: AnyDb) {
  const state = await getRenewalState(db)
  if (state) {
    await db
      .update(timeBalanceRenewalState)
      .set({ lastRunAt: new Date(), updatedAt: new Date() })
      .where(eq(timeBalanceRenewalState.id, state.id))
  }
}
