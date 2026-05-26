import { compensatoryTimeBalances, compensatoryTimeMovements } from '@payroll/db'
import { and, desc, eq, sql } from 'drizzle-orm'

// biome-ignore lint/suspicious/noExplicitAny: Drizzle db instance
type AnyDb = any

const ANNUAL_HOURS = 144

export type PoolType = 'compensatory' | 'disability' | 'family_disability'

export interface BalanceSnapshot {
  pool: PoolType
  earned: number
  used: number
  reserved: number
  available: number
  year: number
}

export async function getBalance(
  db: AnyDb,
  employeeId: string,
  year?: number
): Promise<BalanceSnapshot[]> {
  const targetYear = year ?? new Date().getFullYear()

  const rows = await db
    .select()
    .from(compensatoryTimeBalances)
    .where(
      and(
        eq(compensatoryTimeBalances.employeeId, employeeId),
        eq(compensatoryTimeBalances.year, targetYear)
      )
    )

  // biome-ignore lint/suspicious/noExplicitAny: raw drizzle row
  return rows.map((r: any) => ({
    pool: r.pool as PoolType,
    earned: Number(r.earned),
    used: Number(r.used),
    reserved: Number(r.reserved),
    available: Number(r.earned) - Number(r.used) - Number(r.reserved),
    year: r.year,
  }))
}

export async function initializePoolForEmployee(
  db: AnyDb,
  employeeId: string,
  pool: PoolType,
  year: number,
  performedBy?: string
): Promise<{ created: boolean }> {
  const existing = await db
    .select({ id: compensatoryTimeBalances.id })
    .from(compensatoryTimeBalances)
    .where(
      and(
        eq(compensatoryTimeBalances.employeeId, employeeId),
        eq(compensatoryTimeBalances.pool, pool),
        eq(compensatoryTimeBalances.year, year)
      )
    )
    .limit(1)

  if (existing.length > 0) return { created: false }

  await db.insert(compensatoryTimeBalances).values({
    employeeId,
    pool,
    earned: String(ANNUAL_HOURS),
    used: '0',
    reserved: '0',
    year,
  })

  await db.insert(compensatoryTimeMovements).values({
    employeeId,
    pool,
    movementType: 'initialization',
    hours: String(ANNUAL_HOURS),
    balanceBefore: '0',
    balanceAfter: String(ANNUAL_HOURS),
    notes: `Inicialización ${year} — ${ANNUAL_HOURS} horas`,
    performedBy,
  })

  return { created: true }
}

export async function initializeEmployeeBalances(
  db: AnyDb,
  employeeId: string,
  options: {
    hasDisability?: boolean
    hasFamilyDisability?: boolean
    year?: number
    performedBy?: string
  } = {}
) {
  const year = options.year ?? new Date().getFullYear()
  const results: Record<string, boolean> = {}

  const r1 = await initializePoolForEmployee(
    db,
    employeeId,
    'compensatory',
    year,
    options.performedBy
  )
  results.compensatory = r1.created

  if (options.hasDisability) {
    const r2 = await initializePoolForEmployee(
      db,
      employeeId,
      'disability',
      year,
      options.performedBy
    )
    results.disability = r2.created
  }

  if (options.hasFamilyDisability) {
    const r3 = await initializePoolForEmployee(
      db,
      employeeId,
      'family_disability',
      year,
      options.performedBy
    )
    results.family_disability = r3.created
  }

  return results
}

export async function addHours(
  db: AnyDb,
  employeeId: string,
  pool: PoolType,
  hours: number,
  movementType: string,
  options: {
    referenceType?: string
    referenceId?: string
    notes?: string
    performedBy?: string
  } = {}
) {
  const year = new Date().getFullYear()

  const [balance] = await db
    .select()
    .from(compensatoryTimeBalances)
    .where(
      and(
        eq(compensatoryTimeBalances.employeeId, employeeId),
        eq(compensatoryTimeBalances.pool, pool),
        eq(compensatoryTimeBalances.year, year)
      )
    )
    .limit(1)

  if (!balance) {
    await initializePoolForEmployee(db, employeeId, pool, year, options.performedBy)
    return addHours(db, employeeId, pool, hours, movementType, options)
  }

  const before = Number(balance.earned)
  const after = before + hours

  await db
    .update(compensatoryTimeBalances)
    .set({
      earned: String(after),
      updatedAt: new Date(),
    })
    .where(eq(compensatoryTimeBalances.id, balance.id))

  await db.insert(compensatoryTimeMovements).values({
    employeeId,
    pool,
    movementType,
    hours: String(hours),
    balanceBefore: String(before),
    balanceAfter: String(after),
    referenceType: options.referenceType ?? null,
    referenceId: options.referenceId ?? null,
    notes: options.notes ?? null,
    performedBy: options.performedBy ?? null,
  })

  return { before, after, hours }
}

export async function deductHours(
  db: AnyDb,
  employeeId: string,
  pool: PoolType,
  hours: number,
  movementType: string,
  options: {
    referenceType?: string
    referenceId?: string
    notes?: string
    performedBy?: string
  } = {}
) {
  const year = new Date().getFullYear()

  const [balance] = await db
    .select()
    .from(compensatoryTimeBalances)
    .where(
      and(
        eq(compensatoryTimeBalances.employeeId, employeeId),
        eq(compensatoryTimeBalances.pool, pool),
        eq(compensatoryTimeBalances.year, year)
      )
    )
    .limit(1)

  if (!balance) {
    await initializePoolForEmployee(db, employeeId, pool, year, options.performedBy)
    return deductHours(db, employeeId, pool, hours, movementType, options)
  }

  const beforeUsed = Number(balance.used)
  const afterUsed = beforeUsed + hours
  const available = Number(balance.earned) - afterUsed - Number(balance.reserved)

  await db
    .update(compensatoryTimeBalances)
    .set({
      used: String(afterUsed),
      updatedAt: new Date(),
    })
    .where(eq(compensatoryTimeBalances.id, balance.id))

  await db.insert(compensatoryTimeMovements).values({
    employeeId,
    pool,
    movementType,
    hours: String(-hours),
    balanceBefore: String(Number(balance.earned) - beforeUsed - Number(balance.reserved)),
    balanceAfter: String(available),
    referenceType: options.referenceType ?? null,
    referenceId: options.referenceId ?? null,
    notes: options.notes ?? null,
    performedBy: options.performedBy ?? null,
  })

  return { beforeUsed, afterUsed, available }
}

export async function listMovements(
  db: AnyDb,
  employeeId: string,
  options: { pool?: PoolType; year?: number; limit?: number } = {}
) {
  const conditions = [eq(compensatoryTimeMovements.employeeId, employeeId)]
  if (options.pool) {
    conditions.push(eq(compensatoryTimeMovements.pool, options.pool))
  }

  const rows = await db
    .select()
    .from(compensatoryTimeMovements)
    .where(and(...conditions))
    .orderBy(desc(compensatoryTimeMovements.createdAt))
    .limit(options.limit ?? 50)

  return rows
}

export async function initializeYearForAllEmployees(
  db: AnyDb,
  year: number,
  performedBy?: string
): Promise<{ total: number; initialized: number }> {
  // biome-ignore lint/suspicious/noExplicitAny: raw SQL result
  const empRows: any[] = await db.execute(sql`SELECT id FROM employees WHERE is_active = true`)

  let initialized = 0

  for (const emp of empRows) {
    // biome-ignore lint/suspicious/noExplicitAny: raw SQL result
    const depRows: any[] = await db.execute(
      sql`SELECT has_disability FROM dependents
          WHERE employee_id = ${emp.id} AND is_active = true AND has_disability = true
          LIMIT 1`
    )
    const hasFamilyDisability = depRows.length > 0

    const results = await initializeEmployeeBalances(db, emp.id, {
      hasFamilyDisability,
      year,
      performedBy,
    })

    if (results.compensatory) initialized++
  }

  return { total: empRows.length, initialized }
}
