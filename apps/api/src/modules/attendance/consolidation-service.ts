/**
 * Consolidation service — bridges the pure consolidator with the DB.
 *
 * For a given date (or date range), loads punches from both
 * `attendance_punches` and `facial_punches`, groups by employee,
 * applies the shift + calendar, and upserts `attendance_records`
 * with computed workedMinutes, lateMinutes, overtimeMinutes, status.
 *
 * Also handles absence detection: for employees with NO punches on
 * a workday, creates an `attendance_records` row with status='absent'.
 */
import { type ConsolidateInput, type ShiftSnapshot, consolidateDay } from '@payroll/core/attendance'
import { attendancePunches, attendanceRecords, employees, shifts, workCalendar } from '@payroll/db'
import { and, eq, gte, lte, sql } from 'drizzle-orm'

// biome-ignore lint/suspicious/noExplicitAny: drizzle generic
type AnyDb = any

type PunchKind = 'entry' | 'exit' | 'lunch_start' | 'lunch_end' | 'extra'
const PUNCH_TYPE_TO_KIND: Record<number, PunchKind> = {
  0: 'entry',
  1: 'lunch_start',
  2: 'lunch_end',
  3: 'exit',
}

async function getDefaultShift(db: AnyDb): Promise<ShiftSnapshot | null> {
  const [row] = await db.select().from(shifts).where(eq(shifts.isDefault, true)).limit(1)
  if (!row) {
    const [any] = await db.select().from(shifts).limit(1)
    if (!any) return null
    return shiftToSnapshot(any)
  }
  return shiftToSnapshot(row)
}

function shiftToSnapshot(s: Record<string, unknown>): ShiftSnapshot {
  return {
    entryTime: String(s.entryTime ?? '08:00'),
    exitTime: String(s.exitTime ?? '17:00'),
    lunchStartTime: s.lunchStartTime ? String(s.lunchStartTime) : null,
    lunchEndTime: s.lunchEndTime ? String(s.lunchEndTime) : null,
    entryToleranceAfter: Number(s.entryToleranceAfter ?? 0),
    exitToleranceBefore: Number(s.exitToleranceBefore ?? 0),
    lunchStartToleranceAfter: Number(s.lunchStartToleranceAfter ?? 0),
    lunchEndToleranceAfter: Number(s.lunchEndToleranceAfter ?? 0),
    weekdays: (s.weekdays as number[]) ?? [1, 2, 3, 4, 5],
  }
}

export type ConsolidationResult = {
  date: string
  processed: number
  absent: number
  errors: string[]
}

/**
 * Consolidate all employees for a given date. Steps:
 *
 * 1. Load default shift + calendar entry for the date
 * 2. Load ALL punches (attendance_punches + facial_punches) for the date
 * 3. Load all active employees
 * 4. For each employee: run consolidateDay() → upsert attendance_records
 * 5. For employees with NO punches on a workday: mark absent
 */
export async function consolidateDate(db: AnyDb, date: string): Promise<ConsolidationResult> {
  const shift = await getDefaultShift(db)
  const [calRow] = await db.select().from(workCalendar).where(eq(workCalendar.date, date)).limit(1)

  const calendar = calRow
    ? { date, isWorkday: calRow.isWorkday as boolean, shiftOverride: null }
    : null

  const dayStart = new Date(`${date}T00:00:00`)
  const dayEnd = new Date(`${date}T23:59:59.999`)

  // Load attendance_punches for the date
  const attPunches = await db
    .select()
    .from(attendancePunches)
    .where(
      and(gte(attendancePunches.punchedAt, dayStart), lte(attendancePunches.punchedAt, dayEnd))
    )

  // Load facial_punches (best-effort — table may not exist)
  let facialPunches: Array<{
    employee_id: string
    kind: string
    captured_at: Date
    status: string
  }> = []
  try {
    facialPunches = await db.execute(sql`
      SELECT employee_id, kind, captured_at, status
      FROM facial_punches
      WHERE captured_at >= ${dayStart} AND captured_at <= ${dayEnd}
    `)
  } catch {
    // table doesn't exist — skip
  }

  // Load all active employees
  const activeEmployees = await db
    .select({ id: employees.id })
    .from(employees)
    .where(eq(employees.isActive, true))
  const allEmployeeIds = new Set((activeEmployees as Array<{ id: string }>).map((e) => e.id))

  // Group punches by employee
  const punchesByEmployee = new Map<string, ConsolidateInput['marcaciones']>()

  for (const p of attPunches as Array<Record<string, unknown>>) {
    const empId = String(p.employeeId)
    const arr = punchesByEmployee.get(empId) ?? []
    arr.push({
      employeeId: empId,
      kind: PUNCH_TYPE_TO_KIND[Number(p.punchType)] ?? 'extra',
      capturedAt: p.punchedAt as Date,
      status: 'verified',
    })
    punchesByEmployee.set(empId, arr)
  }

  for (const p of facialPunches) {
    const empId = String(p.employee_id)
    const arr = punchesByEmployee.get(empId) ?? []
    arr.push({
      employeeId: empId,
      kind: p.kind as PunchKind,
      capturedAt: p.captured_at,
      status: p.status as 'verified' | 'pending' | 'rejected' | 'manual',
    })
    punchesByEmployee.set(empId, arr)
  }

  let processed = 0
  let absent = 0
  const errors: string[] = []

  // Process employees WITH punches
  for (const [empId, marcaciones] of punchesByEmployee) {
    try {
      const result = consolidateDay({
        employeeId: empId,
        date,
        marcaciones,
        shift,
        calendar,
      })

      await upsertConsolidatedRecord(db, result, shift)
      processed++
    } catch (err) {
      errors.push(`${empId}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // Detect absences — employees with NO punches on a workday
  const isWorkday = calendar ? calendar.isWorkday : true
  if (isWorkday) {
    for (const empId of allEmployeeIds) {
      if (punchesByEmployee.has(empId)) continue

      // Check if there's already a record for this day (manual entry perhaps)
      const [existing] = await db
        .select({ id: attendanceRecords.id })
        .from(attendanceRecords)
        .where(and(eq(attendanceRecords.employeeId, empId), eq(attendanceRecords.date, date)))
        .limit(1)

      if (existing) continue

      try {
        await db.insert(attendanceRecords).values({
          employeeId: empId,
          date,
          workedMinutes: 0,
          lateMinutes: 0,
          overtimeMinutes: 0,
          status: 'absent',
          shiftId: null,
          source: 'system',
        })
        absent++
      } catch (err) {
        errors.push(`absent-${empId}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  }

  return { date, processed, absent, errors }
}

async function upsertConsolidatedRecord(
  db: AnyDb,
  result: ReturnType<typeof consolidateDay>,
  shift: ShiftSnapshot | null
) {
  const fmtTs = (d: Date | null) => d?.toISOString() ?? null

  const [existing] = await db
    .select({ id: attendanceRecords.id })
    .from(attendanceRecords)
    .where(
      and(
        eq(attendanceRecords.employeeId, result.employeeId),
        eq(attendanceRecords.date, result.date)
      )
    )
    .limit(1)

  const values = {
    checkIn: fmtTs(result.checkIn),
    checkOut: fmtTs(result.checkOut),
    lunchStart: fmtTs(result.lunchStart),
    lunchEnd: fmtTs(result.lunchEnd),
    workedMinutes: result.workedMinutes,
    lateMinutes: result.lateMinutes,
    overtimeMinutes: result.overtimeMinutes,
    status: result.status,
    source: 'system',
  }

  if (existing) {
    await db.update(attendanceRecords).set(values).where(eq(attendanceRecords.id, existing.id))
  } else {
    await db.insert(attendanceRecords).values({
      employeeId: result.employeeId,
      date: result.date,
      ...values,
    })
  }
}
