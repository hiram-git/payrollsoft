/**
 * Attendance consolidator.
 *
 * Takes raw marcaciones (events captured by the facial-recognition kiosk
 * or by a manual override) and folds them into the daily summary the
 * payroll engine consumes: checkIn / lunchStart / lunchEnd / checkOut and
 * the derived workedMinutes / lateMinutes / earlyLeaveMinutes /
 * overtimeMinutes / status.
 *
 * The module is pure (no DB, no IO) so it's reusable from:
 *   - the consolidator job in apps/api
 *   - the live dashboard (preview today's totals)
 *   - tests
 *
 * Time handling is timezone-naive on the date string: we trust the caller
 * to send the marcacion `capturedAt` already aligned to the company's
 * timezone (the rest of the system uses America/Panama).
 */
import type { PunchKind } from '@payroll/types'

export type RawMarcacion = {
  id?: string
  employeeId: string
  kind: PunchKind
  capturedAt: Date | string
  status?: 'verified' | 'pending' | 'rejected' | 'manual'
}

export type ShiftSnapshot = {
  /** "HH:MM" or "HH:MM:SS" */
  entryTime: string
  exitTime: string
  lunchStartTime?: string | null
  lunchEndTime?: string | null
  /** Tolerance in minutes — late/early thresholds. */
  entryToleranceAfter: number
  exitToleranceBefore: number
  lunchStartToleranceAfter?: number
  lunchEndToleranceAfter?: number
  /** ISO weekdays (1=Mon..7=Sun) the shift applies to. */
  weekdays: number[]
}

export type CalendarSnapshot = {
  /** YYYY-MM-DD */
  date: string
  isWorkday: boolean
  /** When non-null, overrides the shift for the day. */
  shiftOverride?: ShiftSnapshot | null
}

export type ConsolidatedDay = {
  employeeId: string
  date: string
  checkIn: Date | null
  lunchStart: Date | null
  lunchEnd: Date | null
  checkOut: Date | null
  workedMinutes: number
  lateMinutes: number
  earlyLeaveMinutes: number
  lunchOverMinutes: number
  overtimeMinutes: number
  expectedMinutes: number
  isAbsent: boolean
  isHoliday: boolean
  status: 'present' | 'late' | 'absent' | 'partial' | 'holiday' | 'rest'
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toDate(v: Date | string): Date {
  return v instanceof Date ? v : new Date(v)
}

function dateAt(dateStr: string, hhmm: string): Date {
  const t = hhmm.length === 5 ? `${hhmm}:00` : hhmm
  return new Date(`${dateStr}T${t}`)
}

function diffMinutes(a: Date, b: Date): number {
  return Math.round((a.getTime() - b.getTime()) / 60000)
}

function pickEarliest(events: RawMarcacion[]): Date | null {
  if (events.length === 0) return null
  return events.map((e) => toDate(e.capturedAt)).reduce((a, b) => (a < b ? a : b))
}

function pickLatest(events: RawMarcacion[]): Date | null {
  if (events.length === 0) return null
  return events.map((e) => toDate(e.capturedAt)).reduce((a, b) => (a > b ? a : b))
}

function isoWeekday(date: Date): number {
  // JS Sunday=0..Saturday=6; ISO Mon=1..Sun=7
  const d = date.getDay()
  return d === 0 ? 7 : d
}

// ─── Public API ───────────────────────────────────────────────────────────────

export type ConsolidateInput = {
  employeeId: string
  date: string
  marcaciones: RawMarcacion[]
  shift: ShiftSnapshot | null
  calendar?: CalendarSnapshot | null
}

/**
 * Pure function: consolidate marcaciones for a single employee/day.
 *
 * Rules implemented:
 *  - checkIn  = earliest "entry" marcacion of the day
 *  - lunchStart = earliest "lunch_start"
 *  - lunchEnd = latest "lunch_end" (but >= lunchStart if present)
 *  - checkOut = latest "exit"
 *  - workedMinutes = (checkOut - checkIn) - (lunchEnd - lunchStart)
 *  - lateMinutes  = max(0, checkIn - entryTime - tolerance)
 *  - earlyLeave   = max(0, exitTime - checkOut - tolerance)
 *  - overtime     = max(0, workedMinutes - expectedMinutes)
 *  - lunchOver    = minutes the lunch break exceeded the scheduled span
 *  - holiday / rest take precedence over the regular calculation
 */
export function consolidateDay(input: ConsolidateInput): ConsolidatedDay {
  const { employeeId, date, marcaciones, calendar } = input
  const shift = calendar?.shiftOverride ?? input.shift

  // Rest day or holiday short-circuits the normal flow.
  if (calendar && !calendar.isWorkday) {
    const allEvents = marcaciones.filter((m) => m.status !== 'rejected')
    const workedMinutes = computeWorkedMinutes(allEvents)
    return {
      employeeId,
      date,
      checkIn: pickEarliest(allEvents.filter((m) => m.kind === 'entry')),
      lunchStart: pickEarliest(allEvents.filter((m) => m.kind === 'lunch_start')),
      lunchEnd: pickLatest(allEvents.filter((m) => m.kind === 'lunch_end')),
      checkOut: pickLatest(allEvents.filter((m) => m.kind === 'exit')),
      workedMinutes,
      lateMinutes: 0,
      earlyLeaveMinutes: 0,
      lunchOverMinutes: 0,
      overtimeMinutes: workedMinutes, // every minute worked on a rest day is overtime
      expectedMinutes: 0,
      isAbsent: false,
      isHoliday: true,
      status: 'holiday',
    }
  }

  const valid = marcaciones.filter((m) => m.status !== 'rejected')
  const checkIn = pickEarliest(valid.filter((m) => m.kind === 'entry'))
  const lunchStart = pickEarliest(valid.filter((m) => m.kind === 'lunch_start'))
  const lunchEnd = pickLatest(valid.filter((m) => m.kind === 'lunch_end'))
  const checkOut = pickLatest(valid.filter((m) => m.kind === 'exit'))

  // If there is no shift assigned, fall back to a permissive calculation.
  if (!shift) {
    const workedMinutes = computeWorkedMinutes(valid)
    return {
      employeeId,
      date,
      checkIn,
      lunchStart,
      lunchEnd,
      checkOut,
      workedMinutes,
      lateMinutes: 0,
      earlyLeaveMinutes: 0,
      lunchOverMinutes: 0,
      overtimeMinutes: 0,
      expectedMinutes: 0,
      isAbsent: valid.length === 0,
      isHoliday: false,
      status: valid.length === 0 ? 'absent' : 'present',
    }
  }

  // Day not in the shift's weekday set → treat as rest.
  const today = new Date(`${date}T12:00:00`)
  const wd = isoWeekday(today)
  if (!shift.weekdays.includes(wd)) {
    const workedMinutes = computeWorkedMinutes(valid)
    return {
      employeeId,
      date,
      checkIn,
      lunchStart,
      lunchEnd,
      checkOut,
      workedMinutes,
      lateMinutes: 0,
      earlyLeaveMinutes: 0,
      lunchOverMinutes: 0,
      overtimeMinutes: workedMinutes,
      expectedMinutes: 0,
      isAbsent: false,
      isHoliday: false,
      status: 'rest',
    }
  }

  // ── Regular workday calculation ─────────────────────────────────────────
  const scheduledEntry = dateAt(date, shift.entryTime)
  const scheduledExit = dateAt(date, shift.exitTime)
  const scheduledLunchStart = shift.lunchStartTime ? dateAt(date, shift.lunchStartTime) : null
  const scheduledLunchEnd = shift.lunchEndTime ? dateAt(date, shift.lunchEndTime) : null

  let totalMinutes = diffMinutes(scheduledExit, scheduledEntry)
  if (scheduledLunchStart && scheduledLunchEnd) {
    totalMinutes -= diffMinutes(scheduledLunchEnd, scheduledLunchStart)
  }
  const expectedMinutes = Math.max(0, totalMinutes)

  const lateMinutes = checkIn
    ? Math.max(0, diffMinutes(checkIn, scheduledEntry) - (shift.entryToleranceAfter ?? 0))
    : 0

  const earlyLeaveMinutes = checkOut
    ? Math.max(0, diffMinutes(scheduledExit, checkOut) - (shift.exitToleranceBefore ?? 0))
    : 0

  const lunchOverMinutes =
    scheduledLunchStart && scheduledLunchEnd && lunchStart && lunchEnd
      ? Math.max(
          0,
          diffMinutes(lunchEnd, lunchStart) - diffMinutes(scheduledLunchEnd, scheduledLunchStart)
        )
      : 0

  const workedMinutes = computeWorkedMinutes(valid)
  const overtimeMinutes = Math.max(0, workedMinutes - expectedMinutes)
  const isAbsent = valid.length === 0
  const status: ConsolidatedDay['status'] = isAbsent
    ? 'absent'
    : lateMinutes > 0
      ? 'late'
      : !checkOut
        ? 'partial'
        : 'present'

  return {
    employeeId,
    date,
    checkIn,
    lunchStart,
    lunchEnd,
    checkOut,
    workedMinutes,
    lateMinutes,
    earlyLeaveMinutes,
    lunchOverMinutes,
    overtimeMinutes,
    expectedMinutes,
    isAbsent,
    isHoliday: false,
    status,
  }
}

function computeWorkedMinutes(events: RawMarcacion[]): number {
  // Pair entry/exit and subtract lunch breaks. We support multiple
  // entry/exit pairs (split shifts) by walking the sorted timeline.
  const sorted = [...events].sort(
    (a, b) => toDate(a.capturedAt).getTime() - toDate(b.capturedAt).getTime()
  )

  let total = 0
  let entryAt: Date | null = null
  let lunchAt: Date | null = null

  for (const e of sorted) {
    const at = toDate(e.capturedAt)
    if (e.kind === 'entry' && !entryAt) {
      entryAt = at
    } else if (e.kind === 'lunch_start' && entryAt && !lunchAt) {
      total += diffMinutes(at, entryAt)
      lunchAt = at
      entryAt = null
    } else if (e.kind === 'lunch_end' && lunchAt) {
      // resume after lunch
      entryAt = at
      lunchAt = null
    } else if ((e.kind === 'exit' || e.kind === 'extra') && entryAt) {
      total += diffMinutes(at, entryAt)
      entryAt = null
    }
  }

  return Math.max(0, total)
}
