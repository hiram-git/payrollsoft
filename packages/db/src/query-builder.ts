import { and, asc, count, desc, eq, ilike, or, sql } from 'drizzle-orm'
import type { createPublicDb, createTenantDb } from './client'
import {
  cargos,
  concepts,
  departamentos,
  employees,
  funciones,
  loans,
  payrollLines,
  payrolls,
  superAdmins,
  users,
} from './schema'

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

// ─── Employee Mutations ───────────────────────────────────────────────────────

export type CreateEmployeeData = typeof employees.$inferInsert

/**
 * Insert a new employee and return the created row.
 */
export async function createEmployee(db: Db, data: CreateEmployeeData) {
  const [row] = await db.insert(employees).values(data).returning()
  return row
}

export type UpdateEmployeeData = Partial<Omit<CreateEmployeeData, 'id' | 'createdAt'>>

/**
 * Update an employee by ID. Always bumps updatedAt.
 */
export async function updateEmployee(db: Db, id: string, data: UpdateEmployeeData) {
  const [row] = await db
    .update(employees)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(employees.id, id))
    .returning()
  return row ?? null
}

/**
 * Soft-delete: marks the employee as inactive with today's termination date.
 */
export async function deactivateEmployee(db: Db, id: string) {
  const today = new Date().toISOString().split('T')[0]
  const [row] = await db
    .update(employees)
    .set({ isActive: false, terminationDate: today, updatedAt: new Date() })
    .where(eq(employees.id, id))
    .returning()
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

// ─── Catalog Helpers ──────────────────────────────────────────────────────────

type CatalogTable = typeof cargos | typeof funciones

async function listCatalog(db: Db, table: CatalogTable, search?: string) {
  const conditions = search
    ? [or(ilike(table.code, `%${search}%`), ilike(table.name, `%${search}%`))]
    : []
  const where = conditions.length > 0 ? and(...conditions) : undefined
  return db
    .select()
    .from(table as never)
    .where(where)
    .orderBy(asc(table.name))
}

async function getCatalogById(db: Db, table: CatalogTable, id: string) {
  const [row] = await db
    .select()
    .from(table as never)
    .where(eq(table.id, id))
  return row ?? null
}

async function getCatalogByCode(db: Db, table: CatalogTable, code: string) {
  const [row] = await db
    .select()
    .from(table as never)
    .where(eq(table.code, code))
  return row ?? null
}

// ─── Cargos ───────────────────────────────────────────────────────────────────

export function listCargos(db: Db, search?: string) {
  return listCatalog(db, cargos, search)
}

export function getCargoById(db: Db, id: string) {
  return getCatalogById(db, cargos, id)
}

export function getCargoByCode(db: Db, code: string) {
  return getCatalogByCode(db, cargos, code)
}

export type CreateCargoData = typeof cargos.$inferInsert

export async function createCargo(db: Db, data: CreateCargoData) {
  const [row] = await db.insert(cargos).values(data).returning()
  return row
}

export async function updateCargo(db: Db, id: string, data: Partial<CreateCargoData>) {
  const [row] = await db
    .update(cargos)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(cargos.id, id))
    .returning()
  return row ?? null
}

export async function deactivateCargo(db: Db, id: string) {
  const [row] = await db
    .update(cargos)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(cargos.id, id))
    .returning()
  return row ?? null
}

// ─── Funciones ────────────────────────────────────────────────────────────────

export function listFunciones(db: Db, search?: string) {
  return listCatalog(db, funciones, search)
}

export function getFuncionById(db: Db, id: string) {
  return getCatalogById(db, funciones, id)
}

export function getFuncionByCode(db: Db, code: string) {
  return getCatalogByCode(db, funciones, code)
}

export type CreateFuncionData = typeof funciones.$inferInsert

export async function createFuncion(db: Db, data: CreateFuncionData) {
  const [row] = await db.insert(funciones).values(data).returning()
  return row
}

export async function updateFuncion(db: Db, id: string, data: Partial<CreateFuncionData>) {
  const [row] = await db
    .update(funciones)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(funciones.id, id))
    .returning()
  return row ?? null
}

export async function deactivateFuncion(db: Db, id: string) {
  const [row] = await db
    .update(funciones)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(funciones.id, id))
    .returning()
  return row ?? null
}

// ─── Departamentos ────────────────────────────────────────────────────────────

export async function listDepartamentos(db: Db, search?: string) {
  const conditions = search
    ? [or(ilike(departamentos.code, `%${search}%`), ilike(departamentos.name, `%${search}%`))]
    : []
  const where = conditions.length > 0 ? and(...conditions) : undefined
  return db.select().from(departamentos).where(where).orderBy(asc(departamentos.name))
}

export async function getDepartamentoById(db: Db, id: string) {
  const [row] = await db.select().from(departamentos).where(eq(departamentos.id, id))
  return row ?? null
}

export async function getDepartamentoByCode(db: Db, code: string) {
  const [row] = await db.select().from(departamentos).where(eq(departamentos.code, code))
  return row ?? null
}

export type CreateDepartamentoData = typeof departamentos.$inferInsert

export async function createDepartamento(db: Db, data: CreateDepartamentoData) {
  const [row] = await db.insert(departamentos).values(data).returning()
  return row
}

export async function updateDepartamento(
  db: Db,
  id: string,
  data: Partial<CreateDepartamentoData>
) {
  const [row] = await db
    .update(departamentos)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(departamentos.id, id))
    .returning()
  return row ?? null
}

export async function deactivateDepartamento(db: Db, id: string) {
  const [row] = await db
    .update(departamentos)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(departamentos.id, id))
    .returning()
  return row ?? null
}

export async function getActiveChildCount(db: Db, parentId: string): Promise<number> {
  const [result] = await db
    .select({ total: count() })
    .from(departamentos)
    .where(and(eq(departamentos.parentId, parentId), eq(departamentos.isActive, true)))
  return Number(result?.total ?? 0)
}

// ─── Concepts ─────────────────────────────────────────────────────────────────

export async function listConcepts(db: Db, search?: string) {
  const conditions = search
    ? [or(ilike(concepts.code, `%${search}%`), ilike(concepts.name, `%${search}%`))]
    : []
  const where = conditions.length > 0 ? and(...conditions) : undefined
  return db.select().from(concepts).where(where).orderBy(asc(concepts.name))
}

export async function getConceptById(db: Db, id: string) {
  const [row] = await db.select().from(concepts).where(eq(concepts.id, id))
  return row ?? null
}

export async function getConceptByCode(db: Db, code: string) {
  const [row] = await db.select().from(concepts).where(eq(concepts.code, code))
  return row ?? null
}

export type CreateConceptData = typeof concepts.$inferInsert

export async function createConcept(db: Db, data: CreateConceptData) {
  const [row] = await db.insert(concepts).values(data).returning()
  return row
}

export async function updateConcept(db: Db, id: string, data: Partial<CreateConceptData>) {
  const [row] = await db.update(concepts).set(data).where(eq(concepts.id, id)).returning()
  return row ?? null
}

export async function deactivateConcept(db: Db, id: string) {
  const [row] = await db
    .update(concepts)
    .set({ isActive: false })
    .where(eq(concepts.id, id))
    .returning()
  return row ?? null
}

// ─── Loans ────────────────────────────────────────────────────────────────────

export async function listLoansByEmployee(db: Db, employeeId: string) {
  return db
    .select()
    .from(loans)
    .where(eq(loans.employeeId, employeeId))
    .orderBy(desc(loans.createdAt))
}

export async function getLoanById(db: Db, id: string) {
  const [row] = await db.select().from(loans).where(eq(loans.id, id))
  return row ?? null
}

export type CreateLoanData = typeof loans.$inferInsert

export async function createLoan(db: Db, data: CreateLoanData) {
  const [row] = await db.insert(loans).values(data).returning()
  return row
}

export async function updateLoan(db: Db, id: string, data: Partial<CreateLoanData>) {
  const [row] = await db.update(loans).set(data).where(eq(loans.id, id)).returning()
  return row ?? null
}

export async function closeLoan(db: Db, id: string) {
  const [row] = await db.update(loans).set({ isActive: false }).where(eq(loans.id, id)).returning()
  return row ?? null
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
