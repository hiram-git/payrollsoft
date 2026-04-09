import { and, asc, count, desc, eq, ilike, or, sql } from 'drizzle-orm'
import type { createPublicDb, createTenantDb } from './client'
import { employees, payrollLines, payrolls, superAdmins, users } from './schema'

type Db = ReturnType<typeof createTenantDb> | ReturnType<typeof createPublicDb>

// ─── Pagination ───────────────────────────────────────────────────────────────

export type PaginationOptions = {
  page?: number
  limit?: number
  sortOrder?: 'asc' | 'desc'
}

export type PaginatedResult<T> = {
  data: T[]
  total: number
  page: number
  limit: number
  totalPages: number
}

async function paginate<T>(
  db: Db,
  baseQuery: Parameters<Db['select']>[0],
  table: Parameters<typeof db.select>[0],
  options: PaginationOptions
): Promise<PaginatedResult<T>> {
  const page = Math.max(1, options.page ?? 1)
  const limit = Math.min(100, Math.max(1, options.limit ?? 20))
  const offset = (page - 1) * limit

  const [totalResult] = await db.select({ count: count() }).from(table as never)
  const total = Number(totalResult?.count ?? 0)

  return {
    data: [] as T[], // caller fills this
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  }
}

// ─── Employee Queries ─────────────────────────────────────────────────────────

export type EmployeeFilter = {
  search?: string // matches firstName, lastName, code, idNumber
  department?: string
  isActive?: boolean
  payFrequency?: string
}

/**
 * List employees with optional filters and pagination.
 */
export async function listEmployees(
  db: Db,
  filter: EmployeeFilter = {},
  options: PaginationOptions = {}
) {
  const page = Math.max(1, options.page ?? 1)
  const limit = Math.min(100, Math.max(1, options.limit ?? 20))
  const offset = (page - 1) * limit

  const conditions = []

  if (filter.search) {
    const q = `%${filter.search}%`
    conditions.push(
      or(
        ilike(employees.firstName, q),
        ilike(employees.lastName, q),
        ilike(employees.code, q),
        ilike(employees.idNumber, q)
      )
    )
  }

  if (filter.department) {
    conditions.push(ilike(employees.department, `%${filter.department}%`))
  }

  if (filter.isActive !== undefined) {
    conditions.push(eq(employees.isActive, filter.isActive))
  }

  if (filter.payFrequency) {
    conditions.push(eq(employees.payFrequency, filter.payFrequency))
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined

  const [data, totalResult] = await Promise.all([
    db
      .select()
      .from(employees)
      .where(where)
      .orderBy(options.sortOrder === 'desc' ? desc(employees.lastName) : asc(employees.lastName))
      .limit(limit)
      .offset(offset),
    db.select({ total: count() }).from(employees).where(where),
  ])

  const total = Number(totalResult[0]?.total ?? 0)

  return {
    data,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  }
}

/**
 * Get a single employee by ID.
 */
export async function getEmployee(db: Db, id: string) {
  const [row] = await db.select().from(employees).where(eq(employees.id, id))
  return row ?? null
}

/**
 * Get a single employee by code.
 */
export async function getEmployeeByCode(db: Db, code: string) {
  const [row] = await db.select().from(employees).where(eq(employees.code, code))
  return row ?? null
}

// ─── Payroll Queries ──────────────────────────────────────────────────────────

export type PayrollFilter = {
  status?: string
  type?: string
  year?: number
}

/**
 * List payrolls with optional filters.
 */
export async function listPayrolls(
  db: Db,
  filter: PayrollFilter = {},
  options: PaginationOptions = {}
) {
  const page = Math.max(1, options.page ?? 1)
  const limit = Math.min(100, Math.max(1, options.limit ?? 20))
  const offset = (page - 1) * limit

  const conditions = []

  if (filter.status) conditions.push(eq(payrolls.status, filter.status))
  if (filter.type) conditions.push(eq(payrolls.type, filter.type))
  if (filter.year) {
    conditions.push(sql`EXTRACT(YEAR FROM ${payrolls.periodStart}) = ${filter.year}`)
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined

  const [data, totalResult] = await Promise.all([
    db
      .select()
      .from(payrolls)
      .where(where)
      .orderBy(desc(payrolls.periodStart))
      .limit(limit)
      .offset(offset),
    db.select({ total: count() }).from(payrolls).where(where),
  ])

  const total = Number(totalResult[0]?.total ?? 0)

  return {
    data,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  }
}

/**
 * Get all payroll lines for a payroll, with employee data joined.
 */
export async function getPayrollLines(db: Db, payrollId: string) {
  return db
    .select({
      line: payrollLines,
      employee: {
        id: employees.id,
        code: employees.code,
        firstName: employees.firstName,
        lastName: employees.lastName,
        department: employees.department,
        position: employees.position,
      },
    })
    .from(payrollLines)
    .innerJoin(employees, eq(payrollLines.employeeId, employees.id))
    .where(eq(payrollLines.payrollId, payrollId))
    .orderBy(asc(employees.lastName))
}

// ─── Accumulator Query ────────────────────────────────────────────────────────

/**
 * Sum a specific concept across the last N completed payrolls for an employee.
 * Used as the `loadAccumulated` implementation for the FormulaEngine in Phase 3.
 */
export async function loadAccumulated(
  db: Db,
  employeeId: string,
  conceptCode: string,
  periods: number
): Promise<number> {
  // Get last N completed payrolls
  const completedPayrolls = await db
    .select({ id: payrolls.id })
    .from(payrolls)
    .where(eq(payrolls.status, 'paid'))
    .orderBy(desc(payrolls.periodStart))
    .limit(periods)

  if (completedPayrolls.length === 0) return 0

  const payrollIds = completedPayrolls.map((p) => p.id)

  // Sum the concept from each payroll line's concepts JSON array
  const result = await db
    .select({
      total: sql<string>`
        COALESCE(SUM(
          (SELECT SUM((elem->>'amount')::numeric)
           FROM jsonb_array_elements(${payrollLines.concepts}) AS elem
           WHERE elem->>'code' = ${conceptCode}
          )
        ), 0)
      `,
    })
    .from(payrollLines)
    .where(
      and(
        eq(payrollLines.employeeId, employeeId),
        sql`${payrollLines.payrollId} = ANY(${sql.raw(`ARRAY['${payrollIds.join("','")}'::uuid]`)})`
      )
    )

  return Number(result[0]?.total ?? 0)
}

// ─── User Queries ─────────────────────────────────────────────────────────────

/** Find a tenant user by email (case-insensitive). */
export async function findUserByEmail(db: Db, email: string) {
  const [row] = await db.select().from(users).where(eq(users.email, email.toLowerCase()))
  return row ?? null
}

/** Find a super admin by email in the public schema. */
export async function findSuperAdminByEmail(db: Db, email: string) {
  const [row] = await db
    .select()
    .from(superAdmins)
    .where(eq(superAdmins.email, email.toLowerCase()))
  return row ?? null
}
