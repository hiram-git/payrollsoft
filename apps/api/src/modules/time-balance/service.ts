import {
  ANNUAL_MINUTES,
  canDebit,
  computeAvailableMinutes,
  summarizeMovements,
} from '@payroll/core'
import { timeBalanceMovements, timeBalances } from '@payroll/db'
import { and, desc, eq } from 'drizzle-orm'

// biome-ignore lint/suspicious/noExplicitAny: Drizzle db instance
type AnyDb = any

export type BalanceType = 'compensatory' | 'disability' | 'family_disability'

export interface BalanceSnapshot {
  balanceType: BalanceType
  year: number
  initialMinutes: number
  creditedMinutes: number
  debitedMinutes: number
  availableMinutes: number
  balanceId: string | null
}

function currentYear(): number {
  return new Date().getFullYear()
}

async function findBalanceRow(
  db: AnyDb,
  employeeId: string,
  type: BalanceType,
  year: number
): Promise<{ id: string; initialMinutes: number } | null> {
  const [row] = await db
    .select({ id: timeBalances.id, initialMinutes: timeBalances.initialMinutes })
    .from(timeBalances)
    .where(
      and(
        eq(timeBalances.employeeId, employeeId),
        eq(timeBalances.balanceType, type),
        eq(timeBalances.year, year)
      )
    )
    .limit(1)
  return row ?? null
}

async function sumMovements(db: AnyDb, balanceId: string): Promise<number> {
  const rows = await db
    .select({ amountMinutes: timeBalanceMovements.amountMinutes })
    .from(timeBalanceMovements)
    .where(eq(timeBalanceMovements.balanceId, balanceId))
  return computeAvailableMinutes(rows)
}

/**
 * Idempotent: creates the (employee, type, year) balance with an
 * initialization movement of `initialMinutes` (default 144h) if it does not
 * already exist. Returns the balance id.
 */
export async function initializeBalance(
  db: AnyDb,
  employeeId: string,
  type: BalanceType,
  year: number = currentYear(),
  opts: { initialMinutes?: number; performedBy?: string; sourceType?: string } = {}
): Promise<{ balanceId: string; created: boolean }> {
  const existing = await findBalanceRow(db, employeeId, type, year)
  if (existing) return { balanceId: existing.id, created: false }

  const initialMinutes = opts.initialMinutes ?? ANNUAL_MINUTES

  const [inserted] = await db
    .insert(timeBalances)
    .values({ employeeId, balanceType: type, year, initialMinutes })
    .returning({ id: timeBalances.id })

  await db.insert(timeBalanceMovements).values({
    balanceId: inserted.id,
    movementType: 'initialization',
    amountMinutes: initialMinutes,
    sourceType: opts.sourceType ?? 'system_initialization',
    effectiveDate: `${year}-01-01`,
    description: `Inicialización ${year}`,
    createdBy: opts.performedBy ?? null,
  })

  return { balanceId: inserted.id, created: true }
}

/**
 * Available minutes for a (employee, type, year). Computed from the ledger.
 */
export async function getBalance(
  db: AnyDb,
  employeeId: string,
  type: BalanceType,
  year: number = currentYear()
): Promise<BalanceSnapshot> {
  const row = await findBalanceRow(db, employeeId, type, year)
  if (!row) {
    return {
      balanceType: type,
      year,
      initialMinutes: 0,
      creditedMinutes: 0,
      debitedMinutes: 0,
      availableMinutes: 0,
      balanceId: null,
    }
  }
  const movements = await db
    .select({ amountMinutes: timeBalanceMovements.amountMinutes })
    .from(timeBalanceMovements)
    .where(eq(timeBalanceMovements.balanceId, row.id))
  const summary = summarizeMovements(movements)
  return {
    balanceType: type,
    year,
    initialMinutes: row.initialMinutes,
    creditedMinutes: summary.creditedMinutes,
    debitedMinutes: summary.debitedMinutes,
    availableMinutes: summary.availableMinutes,
    balanceId: row.id,
  }
}

export async function listBalancesByEmployee(
  db: AnyDb,
  employeeId: string,
  year: number = currentYear()
): Promise<BalanceSnapshot[]> {
  const types: BalanceType[] = ['compensatory', 'disability', 'family_disability']
  const result: BalanceSnapshot[] = []
  for (const type of types) {
    const snap = await getBalance(db, employeeId, type, year)
    if (snap.balanceId) result.push(snap)
  }
  return result
}

/**
 * Credit minutes to a balance (overtime, manual +). Creates the balance with
 * a zero initialization if it does not exist yet.
 */
export async function creditBalance(
  db: AnyDb,
  employeeId: string,
  type: BalanceType,
  minutes: number,
  opts: {
    movementType?: 'credit' | 'adjustment'
    sourceType?: string
    sourceId?: string
    description?: string
    performedBy?: string
    year?: number
    effectiveDate?: string
  } = {}
): Promise<{ balanceId: string; availableMinutes: number }> {
  if (minutes <= 0) throw new Error('credit amount must be positive')
  const year = opts.year ?? currentYear()

  let row = await findBalanceRow(db, employeeId, type, year)
  if (!row) {
    const init = await initializeBalance(db, employeeId, type, year, {
      initialMinutes: 0,
      performedBy: opts.performedBy,
    })
    row = { id: init.balanceId, initialMinutes: 0 }
  }

  await db.insert(timeBalanceMovements).values({
    balanceId: row.id,
    movementType: opts.movementType ?? 'credit',
    amountMinutes: minutes,
    sourceType: opts.sourceType ?? 'manual',
    sourceId: opts.sourceId ?? null,
    effectiveDate: opts.effectiveDate ?? new Date().toISOString().slice(0, 10),
    description: opts.description ?? null,
    createdBy: opts.performedBy ?? null,
  })

  const available = await sumMovements(db, row.id)
  return { balanceId: row.id, availableMinutes: available }
}

/**
 * Debit minutes from a balance (absence, tardiness, permission, manual −).
 *
 * Negative-balance policy "permitir con autorización": rejects when the debit
 * would push the balance below zero unless `allowNegative` is set (granted by
 * the `time_balance:override` permission).
 *
 * Returns `{ ok: false, ... }` when rejected so the caller can surface a
 * human-readable message.
 */
export async function debitBalance(
  db: AnyDb,
  employeeId: string,
  type: BalanceType,
  minutes: number,
  opts: {
    allowNegative?: boolean
    movementType?: 'debit' | 'adjustment'
    sourceType?: string
    sourceId?: string
    description?: string
    performedBy?: string
    year?: number
    effectiveDate?: string
  } = {}
): Promise<
  | { ok: true; balanceId: string; availableMinutes: number }
  | { ok: false; reason: 'insufficient'; availableMinutes: number; requestedMinutes: number }
> {
  if (minutes <= 0) throw new Error('debit amount must be positive')
  const year = opts.year ?? currentYear()

  let row = await findBalanceRow(db, employeeId, type, year)
  if (!row) {
    const init = await initializeBalance(db, employeeId, type, year, {
      initialMinutes: 0,
      performedBy: opts.performedBy,
    })
    row = { id: init.balanceId, initialMinutes: 0 }
  }

  const available = await sumMovements(db, row.id)
  if (!canDebit(available, minutes, opts.allowNegative ?? false)) {
    return {
      ok: false,
      reason: 'insufficient',
      availableMinutes: available,
      requestedMinutes: minutes,
    }
  }

  await db.insert(timeBalanceMovements).values({
    balanceId: row.id,
    movementType: opts.movementType ?? 'debit',
    amountMinutes: -minutes,
    sourceType: opts.sourceType ?? 'manual',
    sourceId: opts.sourceId ?? null,
    effectiveDate: opts.effectiveDate ?? new Date().toISOString().slice(0, 10),
    description: opts.description ?? null,
    createdBy: opts.performedBy ?? null,
  })

  return { ok: true, balanceId: row.id, availableMinutes: available - minutes }
}

export async function listMovements(
  db: AnyDb,
  employeeId: string,
  opts: { type?: BalanceType; year?: number; limit?: number } = {}
) {
  const year = opts.year ?? currentYear()
  const conditions = [eq(timeBalances.employeeId, employeeId), eq(timeBalances.year, year)]
  if (opts.type) conditions.push(eq(timeBalances.balanceType, opts.type))

  const rows = await db
    .select({
      id: timeBalanceMovements.id,
      balanceType: timeBalances.balanceType,
      movementType: timeBalanceMovements.movementType,
      amountMinutes: timeBalanceMovements.amountMinutes,
      sourceType: timeBalanceMovements.sourceType,
      sourceId: timeBalanceMovements.sourceId,
      effectiveDate: timeBalanceMovements.effectiveDate,
      description: timeBalanceMovements.description,
      createdAt: timeBalanceMovements.createdAt,
    })
    .from(timeBalanceMovements)
    .innerJoin(timeBalances, eq(timeBalanceMovements.balanceId, timeBalances.id))
    .where(and(...conditions))
    .orderBy(desc(timeBalanceMovements.createdAt))
    .limit(opts.limit ?? 100)

  return rows
}

/**
 * Initialize all applicable balances for an employee at year `year`.
 *
 *   - compensatory      : always
 *   - family_disability : when `hasFamilyDisability`
 *   - disability        : BLOCKED — employee schema has no own-disability
 *                         field yet. Pass `hasDisability` once that field
 *                         exists; until then callers leave it false.
 */
export async function initializeEmployeeBalances(
  db: AnyDb,
  employeeId: string,
  opts: {
    hasDisability?: boolean
    hasFamilyDisability?: boolean
    year?: number
    performedBy?: string
  } = {}
): Promise<Record<string, boolean>> {
  const year = opts.year ?? currentYear()
  const result: Record<string, boolean> = {}

  const c = await initializeBalance(db, employeeId, 'compensatory', year, {
    performedBy: opts.performedBy,
  })
  result.compensatory = c.created

  if (opts.hasFamilyDisability) {
    const f = await initializeBalance(db, employeeId, 'family_disability', year, {
      performedBy: opts.performedBy,
    })
    result.family_disability = f.created
  }

  if (opts.hasDisability) {
    const d = await initializeBalance(db, employeeId, 'disability', year, {
      performedBy: opts.performedBy,
    })
    result.disability = d.created
  }

  return result
}
