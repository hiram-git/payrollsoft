import { and, asc, count, desc, eq, gte, ilike, inArray, lte, or, sql } from 'drizzle-orm'
import type { createPublicDb, createTenantDb } from './client'
import {
  attendanceRecords,
  cargos,
  companyConfig,
  conceptAccumulatorLinks,
  conceptAccumulators,
  conceptFrequencies,
  conceptFrequencyLinks,
  conceptPayrollTypeLinks,
  conceptPayrollTypes,
  conceptSituationLinks,
  conceptSituations,
  concepts,
  creditors,
  departamentos,
  employees,
  funciones,
  loanInstallments,
  loans,
  payrollAcumulados,
  payrollLines,
  payrolls,
  shifts,
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

export async function getPayroll(db: Db, id: string) {
  const [row] = await db.select().from(payrolls).where(eq(payrolls.id, id))
  return row ?? null
}

export type CreatePayrollData = typeof payrolls.$inferInsert

export async function createPayroll(db: Db, data: CreatePayrollData) {
  const [row] = await db.insert(payrolls).values(data).returning()
  return row
}

export async function updatePayroll(db: Db, id: string, data: Partial<CreatePayrollData>) {
  const [row] = await db
    .update(payrolls)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(payrolls.id, id))
    .returning()
  return row ?? null
}

export async function deleteCreatedPayroll(db: Db, id: string) {
  await db.delete(payrolls).where(and(eq(payrolls.id, id), eq(payrolls.status, 'created')))
}

export async function deletePayrollLines(db: Db, payrollId: string) {
  await db.delete(payrollLines).where(eq(payrollLines.payrollId, payrollId))
}

/** @deprecated use deleteCreatedPayroll */
export async function deleteDraftPayroll(db: Db, id: string) {
  await deleteCreatedPayroll(db, id)
}

// ─── Payroll Acumulados ───────────────────────────────────────────────────────

export type PayrollAcumuladoInsert = {
  payrollId: string
  employeeId: string
  conceptCode: string
  conceptName: string
  conceptType: string
  amount: string
}

export async function insertPayrollAcumulados(db: Db, items: PayrollAcumuladoInsert[]) {
  if (items.length === 0) return
  await db.insert(payrollAcumulados).values(items)
}

export async function deletePayrollAcumulados(db: Db, payrollId: string) {
  await db.delete(payrollAcumulados).where(eq(payrollAcumulados.payrollId, payrollId))
}

export async function getPayrollAcumulados(db: Db, payrollId: string, employeeId?: string) {
  const conditions = [eq(payrollAcumulados.payrollId, payrollId)]
  if (employeeId) conditions.push(eq(payrollAcumulados.employeeId, employeeId))
  return db
    .select()
    .from(payrollAcumulados)
    .where(and(...conditions))
    .orderBy(asc(payrollAcumulados.conceptCode))
}

export type AcumuladosFilter = {
  employeeId?: string
  conceptCode?: string
  conceptType?: string
  from?: string // YYYY-MM-DD — filters on payroll.periodStart
  to?: string // YYYY-MM-DD — filters on payroll.periodEnd
}

export async function queryAcumulados(db: Db, filter: AcumuladosFilter, page = 1, limit = 100) {
  const conditions = buildAcumuladosConditions(filter)
  const where = conditions.length > 0 ? and(...conditions) : undefined

  const rows = await db
    .select({
      id: payrollAcumulados.id,
      payrollId: payrollAcumulados.payrollId,
      employeeId: payrollAcumulados.employeeId,
      conceptCode: payrollAcumulados.conceptCode,
      conceptName: payrollAcumulados.conceptName,
      conceptType: payrollAcumulados.conceptType,
      amount: payrollAcumulados.amount,
      payrollName: payrolls.name,
      periodStart: payrolls.periodStart,
      periodEnd: payrolls.periodEnd,
      payrollStatus: payrolls.status,
      employeeCode: employees.code,
      firstName: employees.firstName,
      lastName: employees.lastName,
    })
    .from(payrollAcumulados)
    .leftJoin(payrolls, eq(payrollAcumulados.payrollId, payrolls.id))
    .leftJoin(employees, eq(payrollAcumulados.employeeId, employees.id))
    .where(where)
    .orderBy(
      desc(payrolls.periodStart),
      asc(employees.lastName),
      asc(payrollAcumulados.conceptCode)
    )
    .limit(limit)
    .offset((page - 1) * limit)

  const [{ total }] = await db
    .select({ total: count() })
    .from(payrollAcumulados)
    .leftJoin(payrolls, eq(payrollAcumulados.payrollId, payrolls.id))
    .where(where)

  return { rows, total: Number(total) }
}

export async function getAcumuladosSummary(db: Db, filter: AcumuladosFilter) {
  const conditions = buildAcumuladosConditions(filter)
  const where = conditions.length > 0 ? and(...conditions) : undefined

  return db
    .select({
      employeeId: payrollAcumulados.employeeId,
      conceptCode: payrollAcumulados.conceptCode,
      conceptName: payrollAcumulados.conceptName,
      conceptType: payrollAcumulados.conceptType,
      total: sql<string>`COALESCE(SUM(${payrollAcumulados.amount}::numeric), 0)`,
      occurrences: count(),
      employeeCode: employees.code,
      firstName: employees.firstName,
      lastName: employees.lastName,
    })
    .from(payrollAcumulados)
    .leftJoin(payrolls, eq(payrollAcumulados.payrollId, payrolls.id))
    .leftJoin(employees, eq(payrollAcumulados.employeeId, employees.id))
    .where(where)
    .groupBy(
      payrollAcumulados.employeeId,
      payrollAcumulados.conceptCode,
      payrollAcumulados.conceptName,
      payrollAcumulados.conceptType,
      employees.code,
      employees.firstName,
      employees.lastName
    )
    .orderBy(asc(employees.lastName), asc(employees.firstName), asc(payrollAcumulados.conceptCode))
}

function buildAcumuladosConditions(filter: AcumuladosFilter) {
  const conditions = []
  if (filter.employeeId) conditions.push(eq(payrollAcumulados.employeeId, filter.employeeId))
  if (filter.conceptCode)
    conditions.push(eq(payrollAcumulados.conceptCode, filter.conceptCode.toUpperCase()))
  if (filter.conceptType) conditions.push(eq(payrollAcumulados.conceptType, filter.conceptType))
  if (filter.from) conditions.push(gte(payrolls.periodStart, filter.from))
  if (filter.to) conditions.push(lte(payrolls.periodEnd, filter.to))
  return conditions
}

export async function upsertPayrollLine(
  db: Db,
  data: {
    payrollId: string
    employeeId: string
    grossAmount: string
    deductions: string
    netAmount: string
    concepts: unknown
  }
) {
  await db
    .delete(payrollLines)
    .where(
      and(eq(payrollLines.payrollId, data.payrollId), eq(payrollLines.employeeId, data.employeeId))
    )
  const [row] = await db.insert(payrollLines).values(data).returning()
  return row
}

export async function getPayrollLineById(db: Db, lineId: string) {
  const [row] = await db
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
    .where(eq(payrollLines.id, lineId))
  return row ?? null
}

export async function deletePayrollAcumuladosByEmployee(
  db: Db,
  payrollId: string,
  employeeId: string
) {
  await db
    .delete(payrollAcumulados)
    .where(
      and(eq(payrollAcumulados.payrollId, payrollId), eq(payrollAcumulados.employeeId, employeeId))
    )
}

/**
 * Aggregate attendance records for an employee within a date range.
 * Returns summed workedMinutes, lateMinutes, overtimeMinutes and record count.
 */
export async function getAttendanceSummaryForPeriod(
  db: Db,
  employeeId: string,
  startDate: string,
  endDate: string
) {
  const rows = await db
    .select()
    .from(attendanceRecords)
    .where(
      and(
        eq(attendanceRecords.employeeId, employeeId),
        gte(attendanceRecords.date, startDate),
        lte(attendanceRecords.date, endDate)
      )
    )

  const workedMinutes = rows.reduce((s, r) => s + (r.workedMinutes ?? 0), 0)
  const lateMinutes = rows.reduce((s, r) => s + (r.lateMinutes ?? 0), 0)
  const overtimeMinutes = rows.reduce((s, r) => s + (r.overtimeMinutes ?? 0), 0)
  const daysWithRecords = rows.filter((r) => (r.workedMinutes ?? 0) > 0).length

  return { workedMinutes, lateMinutes, overtimeMinutes, daysWithRecords, recordCount: rows.length }
}

// ─── Shifts CRUD ──────────────────────────────────────────────────────────────

export async function listShifts(db: Db) {
  return db.select().from(shifts).orderBy(asc(shifts.name))
}

export async function getShift(db: Db, id: string) {
  const [row] = await db.select().from(shifts).where(eq(shifts.id, id)).limit(1)
  return row ?? null
}

export type CreateShiftData = {
  name: string
  entryTime: string
  lunchStartTime?: string | null
  lunchEndTime?: string | null
  exitTime: string
  entryToleranceBefore?: number
  entryToleranceAfter?: number
  lunchStartToleranceBefore?: number
  lunchStartToleranceAfter?: number
  lunchEndToleranceBefore?: number
  lunchEndToleranceAfter?: number
  exitToleranceBefore?: number
  exitToleranceAfter?: number
  isDefault?: boolean
}

export async function createShift(db: Db, data: CreateShiftData) {
  const [row] = await db
    .insert(shifts)
    .values({
      name: data.name,
      entryTime: data.entryTime,
      lunchStartTime: data.lunchStartTime ?? null,
      lunchEndTime: data.lunchEndTime ?? null,
      exitTime: data.exitTime,
      entryToleranceBefore: data.entryToleranceBefore ?? 0,
      entryToleranceAfter: data.entryToleranceAfter ?? 0,
      lunchStartToleranceBefore: data.lunchStartToleranceBefore ?? 0,
      lunchStartToleranceAfter: data.lunchStartToleranceAfter ?? 0,
      lunchEndToleranceBefore: data.lunchEndToleranceBefore ?? 0,
      lunchEndToleranceAfter: data.lunchEndToleranceAfter ?? 0,
      exitToleranceBefore: data.exitToleranceBefore ?? 0,
      exitToleranceAfter: data.exitToleranceAfter ?? 0,
      isDefault: data.isDefault ?? false,
    })
    .returning()
  return row
}

export async function updateShift(db: Db, id: string, data: Partial<CreateShiftData>) {
  const patch: Record<string, unknown> = { updatedAt: new Date() }
  if (data.name !== undefined) patch.name = data.name
  if (data.entryTime !== undefined) patch.entryTime = data.entryTime
  if ('lunchStartTime' in data) patch.lunchStartTime = data.lunchStartTime ?? null
  if ('lunchEndTime' in data) patch.lunchEndTime = data.lunchEndTime ?? null
  if (data.exitTime !== undefined) patch.exitTime = data.exitTime
  if (data.entryToleranceBefore !== undefined) patch.entryToleranceBefore = data.entryToleranceBefore
  if (data.entryToleranceAfter !== undefined) patch.entryToleranceAfter = data.entryToleranceAfter
  if (data.lunchStartToleranceBefore !== undefined) patch.lunchStartToleranceBefore = data.lunchStartToleranceBefore
  if (data.lunchStartToleranceAfter !== undefined) patch.lunchStartToleranceAfter = data.lunchStartToleranceAfter
  if (data.lunchEndToleranceBefore !== undefined) patch.lunchEndToleranceBefore = data.lunchEndToleranceBefore
  if (data.lunchEndToleranceAfter !== undefined) patch.lunchEndToleranceAfter = data.lunchEndToleranceAfter
  if (data.exitToleranceBefore !== undefined) patch.exitToleranceBefore = data.exitToleranceBefore
  if (data.exitToleranceAfter !== undefined) patch.exitToleranceAfter = data.exitToleranceAfter
  if (data.isDefault !== undefined) patch.isDefault = data.isDefault
  const [row] = await db.update(shifts).set(patch).where(eq(shifts.id, id)).returning()
  return row ?? null
}

export async function deleteShift(db: Db, id: string) {
  await db.delete(shifts).where(eq(shifts.id, id))
}

// ─── Attendance Records CRUD ──────────────────────────────────────────────────

export type AttendanceFilter = {
  date?: string
  employeeId?: string
  from?: string
  to?: string
}

export type AttendanceRecordWithEmployee = {
  record: typeof attendanceRecords.$inferSelect
  employee: {
    id: string
    code: string
    firstName: string
    lastName: string
    department: string | null
    position: string | null
  }
}

export async function listAttendanceRecords(
  db: Db,
  filter: AttendanceFilter = {}
): Promise<AttendanceRecordWithEmployee[]> {
  const conditions = []
  if (filter.date) conditions.push(eq(attendanceRecords.date, filter.date))
  if (filter.employeeId) conditions.push(eq(attendanceRecords.employeeId, filter.employeeId))
  if (filter.from) conditions.push(gte(attendanceRecords.date, filter.from))
  if (filter.to) conditions.push(lte(attendanceRecords.date, filter.to))

  const rows = await db
    .select({
      record: attendanceRecords,
      employee: {
        id: employees.id,
        code: employees.code,
        firstName: employees.firstName,
        lastName: employees.lastName,
        department: employees.department,
        position: employees.position,
      },
    })
    .from(attendanceRecords)
    .innerJoin(employees, eq(attendanceRecords.employeeId, employees.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(attendanceRecords.date), asc(employees.lastName), asc(employees.firstName))

  return rows
}

export async function getAttendanceRecord(
  db: Db,
  id: string
): Promise<AttendanceRecordWithEmployee | null> {
  const [row] = await db
    .select({
      record: attendanceRecords,
      employee: {
        id: employees.id,
        code: employees.code,
        firstName: employees.firstName,
        lastName: employees.lastName,
        department: employees.department,
        position: employees.position,
      },
    })
    .from(attendanceRecords)
    .innerJoin(employees, eq(attendanceRecords.employeeId, employees.id))
    .where(eq(attendanceRecords.id, id))
    .limit(1)
  return row ?? null
}

export type CreateAttendanceData = {
  employeeId: string
  date: string
  checkIn?: string | null
  lunchStart?: string | null
  lunchEnd?: string | null
  checkOut?: string | null
}

export async function upsertAttendanceRecord(db: Db, data: CreateAttendanceData) {
  // Check if a record already exists for this employee+date
  const [existing] = await db
    .select({ id: attendanceRecords.id })
    .from(attendanceRecords)
    .where(
      and(
        eq(attendanceRecords.employeeId, data.employeeId),
        eq(attendanceRecords.date, data.date)
      )
    )
    .limit(1)

  // Helper: convert "HH:MM" or "HH:MM:SS" time string to full timestamp for the given date
  function toTimestamp(dateStr: string, timeStr: string | null | undefined): Date | null {
    if (!timeStr) return null
    const t = timeStr.length === 5 ? `${timeStr}:00` : timeStr
    return new Date(`${dateStr}T${t}`)
  }

  const checkIn = toTimestamp(data.date, data.checkIn as string | null)
  const lunchStart = toTimestamp(data.date, data.lunchStart as string | null)
  const lunchEnd = toTimestamp(data.date, data.lunchEnd as string | null)
  const checkOut = toTimestamp(data.date, data.checkOut as string | null)

  // Calculate workedMinutes (checkIn to checkOut minus lunch duration)
  let workedMinutes = 0
  if (checkIn && checkOut) {
    const total = (checkOut.getTime() - checkIn.getTime()) / 60000
    const lunch = lunchStart && lunchEnd
      ? (lunchEnd.getTime() - lunchStart.getTime()) / 60000
      : 0
    workedMinutes = Math.max(0, Math.round(total - lunch))
  }

  if (existing) {
    const [row] = await db
      .update(attendanceRecords)
      .set({ checkIn, lunchStart, lunchEnd, checkOut, workedMinutes })
      .where(eq(attendanceRecords.id, existing.id))
      .returning()
    return row
  }

  const [row] = await db
    .insert(attendanceRecords)
    .values({
      employeeId: data.employeeId,
      date: data.date,
      checkIn,
      lunchStart,
      lunchEnd,
      checkOut,
      workedMinutes,
      source: 'manual',
    })
    .returning()
  return row
}

export async function deleteAttendanceRecord(db: Db, id: string) {
  await db.delete(attendanceRecords).where(eq(attendanceRecords.id, id))
}

export type UpdateAttendanceData = {
  checkIn?: string | null
  lunchStart?: string | null
  lunchEnd?: string | null
  checkOut?: string | null
}

export async function updateAttendanceById(db: Db, id: string, data: UpdateAttendanceData) {
  const [existing] = await db
    .select()
    .from(attendanceRecords)
    .where(eq(attendanceRecords.id, id))
    .limit(1)
  if (!existing) return null

  function toTimestamp(dateStr: string, timeStr: string | null | undefined): Date | null {
    if (!timeStr) return null
    const t = timeStr.length === 5 ? `${timeStr}:00` : timeStr
    return new Date(`${dateStr}T${t}`)
  }

  const dateStr = existing.date
  const checkIn = 'checkIn' in data ? toTimestamp(dateStr, data.checkIn) : existing.checkIn
  const lunchStart = 'lunchStart' in data ? toTimestamp(dateStr, data.lunchStart) : existing.lunchStart
  const lunchEnd = 'lunchEnd' in data ? toTimestamp(dateStr, data.lunchEnd) : existing.lunchEnd
  const checkOut = 'checkOut' in data ? toTimestamp(dateStr, data.checkOut) : existing.checkOut

  let workedMinutes = existing.workedMinutes ?? 0
  if (checkIn && checkOut) {
    const total = (checkOut.getTime() - checkIn.getTime()) / 60000
    const lunch = lunchStart && lunchEnd
      ? (lunchEnd.getTime() - lunchStart.getTime()) / 60000
      : 0
    workedMinutes = Math.max(0, Math.round(total - lunch))
  }

  const [row] = await db
    .update(attendanceRecords)
    .set({ checkIn, lunchStart, lunchEnd, checkOut, workedMinutes })
    .where(eq(attendanceRecords.id, id))
    .returning()
  return row ?? null
}

/**
 * Sum a specific concept across the last N closed payrolls for an employee.
 * Queries the denormalized payroll_acumulados table for efficiency.
 */
export async function loadAccumulated(
  db: Db,
  employeeId: string,
  conceptCode: string,
  periods: number
): Promise<number> {
  // Get last N closed payrolls ordered by period start
  const closedPayrolls = await db
    .select({ id: payrolls.id })
    .from(payrolls)
    .where(eq(payrolls.status, 'closed'))
    .orderBy(desc(payrolls.periodStart))
    .limit(periods)

  if (closedPayrolls.length === 0) return 0

  const payrollIds = closedPayrolls.map((p) => p.id)

  const result = await db
    .select({
      total: sql<string>`COALESCE(SUM(${payrollAcumulados.amount}::numeric), 0)`,
    })
    .from(payrollAcumulados)
    .where(
      and(
        eq(payrollAcumulados.employeeId, employeeId),
        eq(payrollAcumulados.conceptCode, conceptCode),
        sql`${payrollAcumulados.payrollId} = ANY(${sql.raw(`ARRAY['${payrollIds.join("','")}'::uuid]`)})`
      )
    )

  return Number(result[0]?.total ?? 0)
}

/**
 * Sum a specific concept across closed payrolls whose period falls within
 * the given date range [from, to] (YYYY-MM-DD strings).
 * Used by the ACUMULADOS() date-range form for XIII mes calculations.
 */
export async function loadAccumulatedByDateRange(
  db: Db,
  employeeId: string,
  conceptCode: string,
  from: string,
  to: string
): Promise<number> {
  const payrollsInRange = await db
    .select({ id: payrolls.id })
    .from(payrolls)
    .where(
      and(
        eq(payrolls.status, 'closed'),
        gte(payrolls.periodStart, from),
        lte(payrolls.periodEnd, to)
      )
    )

  if (payrollsInRange.length === 0) return 0

  const payrollIds = payrollsInRange.map((p) => p.id)

  const result = await db
    .select({
      total: sql<string>`COALESCE(SUM(${payrollAcumulados.amount}::numeric), 0)`,
    })
    .from(payrollAcumulados)
    .where(
      and(
        eq(payrollAcumulados.employeeId, employeeId),
        eq(payrollAcumulados.conceptCode, conceptCode),
        inArray(payrollAcumulados.payrollId, payrollIds)
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

export async function activateConcept(db: Db, id: string) {
  const [row] = await db
    .update(concepts)
    .set({ isActive: true })
    .where(eq(concepts.id, id))
    .returning()
  return row ?? null
}

// ─── Concept Config Catalogs ──────────────────────────────────────────────────

export async function getConceptCatalogs(db: Db) {
  const [payrollTypes, frequencies, situations, accumulators] = await Promise.all([
    db.select().from(conceptPayrollTypes).orderBy(asc(conceptPayrollTypes.sortOrder)),
    db.select().from(conceptFrequencies).orderBy(asc(conceptFrequencies.sortOrder)),
    db.select().from(conceptSituations).orderBy(asc(conceptSituations.sortOrder)),
    db.select().from(conceptAccumulators).orderBy(asc(conceptAccumulators.sortOrder)),
  ])
  return { payrollTypes, frequencies, situations, accumulators }
}

export type ConceptLinks = {
  payrollTypeIds: string[]
  frequencyIds: string[]
  situationIds: string[]
  accumulatorIds: string[]
}

export async function getConceptLinks(db: Db, conceptId: string): Promise<ConceptLinks> {
  const [ptLinks, frLinks, siLinks, acLinks] = await Promise.all([
    db
      .select({ id: conceptPayrollTypeLinks.payrollTypeId })
      .from(conceptPayrollTypeLinks)
      .where(eq(conceptPayrollTypeLinks.conceptId, conceptId)),
    db
      .select({ id: conceptFrequencyLinks.frequencyId })
      .from(conceptFrequencyLinks)
      .where(eq(conceptFrequencyLinks.conceptId, conceptId)),
    db
      .select({ id: conceptSituationLinks.situationId })
      .from(conceptSituationLinks)
      .where(eq(conceptSituationLinks.conceptId, conceptId)),
    db
      .select({ id: conceptAccumulatorLinks.accumulatorId })
      .from(conceptAccumulatorLinks)
      .where(eq(conceptAccumulatorLinks.conceptId, conceptId)),
  ])
  return {
    payrollTypeIds: ptLinks.map((r) => r.id),
    frequencyIds: frLinks.map((r) => r.id),
    situationIds: siLinks.map((r) => r.id),
    accumulatorIds: acLinks.map((r) => r.id),
  }
}

export async function setConceptLinks(db: Db, conceptId: string, links: ConceptLinks) {
  // Delete all existing links, then re-insert
  await Promise.all([
    db.delete(conceptPayrollTypeLinks).where(eq(conceptPayrollTypeLinks.conceptId, conceptId)),
    db.delete(conceptFrequencyLinks).where(eq(conceptFrequencyLinks.conceptId, conceptId)),
    db.delete(conceptSituationLinks).where(eq(conceptSituationLinks.conceptId, conceptId)),
    db.delete(conceptAccumulatorLinks).where(eq(conceptAccumulatorLinks.conceptId, conceptId)),
  ])

  await Promise.all([
    links.payrollTypeIds.length > 0
      ? db
          .insert(conceptPayrollTypeLinks)
          .values(links.payrollTypeIds.map((id) => ({ conceptId, payrollTypeId: id })))
      : Promise.resolve(),
    links.frequencyIds.length > 0
      ? db
          .insert(conceptFrequencyLinks)
          .values(links.frequencyIds.map((id) => ({ conceptId, frequencyId: id })))
      : Promise.resolve(),
    links.situationIds.length > 0
      ? db
          .insert(conceptSituationLinks)
          .values(links.situationIds.map((id) => ({ conceptId, situationId: id })))
      : Promise.resolve(),
    links.accumulatorIds.length > 0
      ? db
          .insert(conceptAccumulatorLinks)
          .values(links.accumulatorIds.map((id) => ({ conceptId, accumulatorId: id })))
      : Promise.resolve(),
  ])
}

// ─── Dashboard ───────────────────────────────────────────────────────────────

export async function getDashboardStats(db: Db) {
  const now = new Date()
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)

  const [empResult, conceptResult, loanResult, payrollCountResult, netResult, recentResult] =
    await Promise.all([
      db.select({ total: count() }).from(employees).where(eq(employees.isActive, true)),
      db.select({ total: count() }).from(concepts).where(eq(concepts.isActive, true)),
      db.select({ total: count() }).from(loans).where(eq(loans.isActive, true)),
      db.select({ total: count() }).from(payrolls).where(gte(payrolls.createdAt, firstOfMonth)),
      db
        .select({ net: sql<string>`COALESCE(SUM(${payrolls.totalNet}::numeric), 0)` })
        .from(payrolls)
        .where(
          and(
            gte(payrolls.createdAt, firstOfMonth),
            sql`${payrolls.status} IN ('generated', 'closed')`
          )
        ),
      db.select().from(payrolls).orderBy(desc(payrolls.createdAt)).limit(5),
    ])

  return {
    activeEmployees: Number(empResult[0]?.total ?? 0),
    activeConcepts: Number(conceptResult[0]?.total ?? 0),
    activeLoans: Number(loanResult[0]?.total ?? 0),
    payrollsThisMonth: Number(payrollCountResult[0]?.total ?? 0),
    netThisMonth: Number(netResult[0]?.net ?? 0),
    recentPayrolls: recentResult,
  }
}

// ─── Loans ────────────────────────────────────────────────────────────────────

export async function listLoansByEmployee(db: Db, employeeId: string) {
  return db
    .select()
    .from(loans)
    .where(eq(loans.employeeId, employeeId))
    .orderBy(desc(loans.createdAt))
}

export async function listAllLoans(db: Db, filter: { isActive?: boolean } = {}) {
  const conditions = []
  if (filter.isActive !== undefined) {
    conditions.push(eq(loans.isActive, filter.isActive))
  }
  return db
    .select({
      id: loans.id,
      employeeId: loans.employeeId,
      amount: loans.amount,
      balance: loans.balance,
      installment: loans.installment,
      startDate: loans.startDate,
      endDate: loans.endDate,
      isActive: loans.isActive,
      loanType: loans.loanType,
      frequency: loans.frequency,
      creditor: loans.creditor,
      allowDecember: loans.allowDecember,
      createdAt: loans.createdAt,
      employeeCode: employees.code,
      employeeFirstName: employees.firstName,
      employeeLastName: employees.lastName,
    })
    .from(loans)
    .innerJoin(employees, eq(loans.employeeId, employees.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(loans.createdAt))
    .limit(200)
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

// ─── Creditors ────────────────────────────────────────────────────────────────

export async function listCreditors(db: Db, includeInactive = false) {
  return db
    .select({
      id: creditors.id,
      code: creditors.code,
      name: creditors.name,
      description: creditors.description,
      conceptId: creditors.conceptId,
      isActive: creditors.isActive,
      createdAt: creditors.createdAt,
      conceptCode: concepts.code,
      conceptName: concepts.name,
    })
    .from(creditors)
    .leftJoin(concepts, eq(creditors.conceptId, concepts.id))
    .where(includeInactive ? undefined : eq(creditors.isActive, true))
    .orderBy(asc(creditors.name))
}

export async function getCreditorById(db: Db, id: string) {
  const [row] = await db
    .select({
      id: creditors.id,
      code: creditors.code,
      name: creditors.name,
      description: creditors.description,
      conceptId: creditors.conceptId,
      isActive: creditors.isActive,
      createdAt: creditors.createdAt,
      updatedAt: creditors.updatedAt,
      conceptCode: concepts.code,
      conceptName: concepts.name,
    })
    .from(creditors)
    .leftJoin(concepts, eq(creditors.conceptId, concepts.id))
    .where(eq(creditors.id, id))
  return row ?? null
}

export async function getCreditorByCode(db: Db, code: string) {
  const [row] = await db.select().from(creditors).where(eq(creditors.code, code.toUpperCase()))
  return row ?? null
}

export type CreateCreditorData = typeof creditors.$inferInsert
export async function createCreditor(db: Db, data: CreateCreditorData) {
  const [row] = await db.insert(creditors).values(data).returning()
  return row
}

export async function updateCreditor(db: Db, id: string, data: Partial<CreateCreditorData>) {
  const [row] = await db
    .update(creditors)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(creditors.id, id))
    .returning()
  return row ?? null
}

// ─── Loan Installments ────────────────────────────────────────────────────────

export type CreateLoanInstallmentData = typeof loanInstallments.$inferInsert

export async function createLoanInstallments(
  db: Db,
  items: CreateLoanInstallmentData[]
): Promise<void> {
  if (items.length === 0) return
  await db.insert(loanInstallments).values(items)
}

export async function getLoanInstallments(db: Db, loanId: string) {
  return db
    .select()
    .from(loanInstallments)
    .where(eq(loanInstallments.loanId, loanId))
    .orderBy(asc(loanInstallments.installmentNumber))
}

/**
 * For each active loan belonging to the employee that applies to the given
 * period, return the oldest pending installment (one per loan).
 */
export async function getPendingInstallmentsByEmployee(
  db: Db,
  employeeId: string,
  periodEnd: string
) {
  // Get active loans applicable to the payroll period
  const activeLoans = await db
    .select({ id: loans.id })
    .from(loans)
    .where(
      and(
        eq(loans.employeeId, employeeId),
        eq(loans.isActive, true),
        lte(loans.startDate, periodEnd)
      )
    )

  if (activeLoans.length === 0) return []

  const loanIds = activeLoans.map((l) => l.id)
  const pendingByLoan: Array<typeof loanInstallments.$inferSelect> = []

  for (const lId of loanIds) {
    const [oldest] = await db
      .select()
      .from(loanInstallments)
      .where(and(eq(loanInstallments.loanId, lId), eq(loanInstallments.status, 'pending')))
      .orderBy(asc(loanInstallments.installmentNumber))
      .limit(1)
    if (oldest) pendingByLoan.push(oldest)
  }

  return pendingByLoan
}

export async function markInstallmentPaid(db: Db, installmentId: string, payrollId: string) {
  const [row] = await db
    .update(loanInstallments)
    .set({ status: 'paid', payrollId, paidAt: new Date() })
    .where(eq(loanInstallments.id, installmentId))
    .returning()
  return row ?? null
}

export async function countPendingInstallments(db: Db, loanId: string) {
  const [{ total }] = await db
    .select({ total: count() })
    .from(loanInstallments)
    .where(and(eq(loanInstallments.loanId, loanId), eq(loanInstallments.status, 'pending')))
  return Number(total)
}

/** Undo installment payments made by a specific payroll (used on reopen). */
export async function revertPayrollInstallments(db: Db, payrollId: string) {
  await db
    .update(loanInstallments)
    .set({ status: 'pending', payrollId: null, paidAt: null })
    .where(eq(loanInstallments.payrollId, payrollId))
}

// ─── Company Config ───────────────────────────────────────────────────────────

export async function getCompanyConfig(db: Db) {
  const [row] = await db.select().from(companyConfig).limit(1)
  return row ?? null
}

export type UpsertCompanyConfigData = Partial<typeof companyConfig.$inferInsert>

export async function upsertCompanyConfig(db: Db, data: UpsertCompanyConfigData) {
  const existing = await getCompanyConfig(db)
  if (existing) {
    const [row] = await db
      .update(companyConfig)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(companyConfig.id, existing.id))
      .returning()
    return row
  }
  const [row] = await db
    .insert(companyConfig)
    .values({ ...data, updatedAt: new Date() })
    .returning()
  return row
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

// ─── Creditors ────────────────────────────────────────────────────────────────

export type CreateCreditorData = typeof creditors.$inferInsert

export async function listCreditors(db: Db, includeInactive = false) {
  const where = includeInactive ? undefined : eq(creditors.isActive, true)
  return db.select().from(creditors).where(where).orderBy(asc(creditors.name))
}

export async function getCreditorById(db: Db, id: string) {
  const [row] = await db.select().from(creditors).where(eq(creditors.id, id))
  return row ?? null
}

export async function getCreditorByCode(db: Db, code: string) {
  const [row] = await db
    .select()
    .from(creditors)
    .where(eq(creditors.code, code.toUpperCase()))
  return row ?? null
}

export async function createCreditor(db: Db, data: CreateCreditorData) {
  const [row] = await db.insert(creditors).values(data).returning()
  return row
}

export async function updateCreditor(db: Db, id: string, data: Partial<CreateCreditorData>) {
  const [row] = await db
    .update(creditors)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(creditors.id, id))
    .returning()
  return row ?? null
}

/**
 * Sum all pending loan installments for a given employee + creditor within a payroll period.
 * Used by the CUOTA_ACREEDOR() formula function.
 *
 * Matches loans where:
 *  - creditorId links to the creditor with the given code, OR
 *    the creditor varchar matches the code (legacy free-text loans)
 *  - loan is active
 *  - period overlaps: loan.startDate <= periodEnd AND (loan.endDate IS NULL OR loan.endDate >= periodStart)
 */
export async function loadInstallmentsByCreditor(
  db: Db,
  employeeId: string,
  creditorCode: string,
  periodStart: string,
  periodEnd: string
): Promise<number> {
  // Resolve creditor UUID from code
  const creditor = await getCreditorByCode(db, creditorCode)
  if (!creditor) return 0

  const rows = await db
    .select({ installment: loans.installment })
    .from(loans)
    .where(
      and(
        eq(loans.employeeId, employeeId),
        eq(loans.creditorId, creditor.id),
        eq(loans.isActive, true),
        lte(loans.startDate, periodEnd),
        or(sql`${loans.endDate} IS NULL`, gte(loans.endDate, periodStart))
      )
    )

  return rows.reduce((sum, r) => sum + Number(r.installment), 0)
}
