/**
 * Tenant-scoped work calendar generator.
 *
 * Materialises one row per calendar date in `work_calendar` based on:
 *   - a year (mandatory),
 *   - an optional month list (1..12) — empty means "the whole year",
 *   - one or more shifts whose `weekdays` array decides which days of the
 *     week each shift covers.
 *
 * The generator never deletes existing rows it doesn't touch; days that
 * fall outside any chosen shift's weekdays are inserted as
 * is_workday=false. Re-running with overlapping inputs upserts, so the
 * /config/calendars wizard is safe to call again on the same period.
 */
import { workCalendar } from '@payroll/db'
import { and, asc, gte, lte, sql } from 'drizzle-orm'

// biome-ignore lint/suspicious/noExplicitAny: Drizzle generic
type AnyDb = any

export type InitializeInput = {
  year: number
  months?: number[]
  shifts: Array<{ id: string; weekdays: number[] }>
}

export type InitializeResult = {
  inserted: number
  updated: number
  rangeFrom: string
  rangeTo: string
}

const ALL_MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]

function lastDayOfMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate()
}

function isoWeekday(d: Date): number {
  // JS getDay() returns 0=Sun..6=Sat; we want 1=Mon..7=Sun.
  const js = d.getDay()
  return js === 0 ? 7 : js
}

/**
 * Pick the first shift whose weekdays array contains the given ISO weekday.
 * The wizard caller is responsible for not passing overlapping shifts; the
 * UI surfaces a warning when the union covers a day twice.
 */
function shiftForWeekday(
  shifts: InitializeInput['shifts'],
  weekday: number
): { id: string } | null {
  return shifts.find((s) => s.weekdays.includes(weekday)) ?? null
}

export async function initializeWorkCalendar(
  db: AnyDb,
  input: InitializeInput
): Promise<InitializeResult> {
  if (!Number.isInteger(input.year) || input.year < 1970 || input.year > 2100) {
    throw new Error('year out of range')
  }
  if (input.shifts.length === 0) {
    throw new Error('shifts required')
  }
  const months = (input.months && input.months.length > 0 ? input.months : ALL_MONTHS)
    .filter((m) => m >= 1 && m <= 12)
    .sort((a, b) => a - b)
  if (months.length === 0) {
    throw new Error('months out of range')
  }

  const rows: Array<{
    date: string
    shiftId: string | null
    isWorkday: boolean
  }> = []

  let earliest = ''
  let latest = ''

  for (const month of months) {
    const days = lastDayOfMonth(input.year, month)
    for (let d = 1; d <= days; d++) {
      const dt = new Date(Date.UTC(input.year, month - 1, d))
      const iso = dt.toISOString().slice(0, 10)
      const weekday = isoWeekday(dt)
      const match = shiftForWeekday(input.shifts, weekday)
      rows.push({
        date: iso,
        shiftId: match?.id ?? null,
        isWorkday: !!match,
      })
      if (!earliest || iso < earliest) earliest = iso
      if (!latest || iso > latest) latest = iso
    }
  }

  let inserted = 0
  let updated = 0

  // Count existing rows in the range so we can report inserted vs updated.
  const existing = await db
    .select({ d: workCalendar.date })
    .from(workCalendar)
    .where(and(gte(workCalendar.date, earliest), lte(workCalendar.date, latest)))
  const existingSet = new Set(existing.map((r: { d: string }) => r.d))

  for (const row of rows) {
    if (existingSet.has(row.date)) updated++
    else inserted++
  }

  // Drizzle's onConflictDoUpdate performs the upsert atomically per row.
  // For larger years (~365 inserts) we still issue a single VALUES batch
  // by chunking; postgres handles this fine in a single round-trip.
  const CHUNK = 200
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK)
    await db
      .insert(workCalendar)
      .values(slice)
      .onConflictDoUpdate({
        target: workCalendar.date,
        set: {
          shiftId: sql`excluded.shift_id`,
          isWorkday: sql`excluded.is_workday`,
          updatedAt: new Date(),
        },
      })
  }

  return { inserted, updated, rangeFrom: earliest, rangeTo: latest }
}

export async function listWorkCalendar(db: AnyDb, filter: { from?: string; to?: string } = {}) {
  const conds = []
  if (filter.from) conds.push(gte(workCalendar.date, filter.from))
  if (filter.to) conds.push(lte(workCalendar.date, filter.to))
  return db
    .select()
    .from(workCalendar)
    .where(conds.length > 0 ? and(...conds) : undefined)
    .orderBy(asc(workCalendar.date))
}

export async function deleteWorkCalendarYear(db: AnyDb, year: number): Promise<number> {
  if (!Number.isInteger(year) || year < 1970 || year > 2100) {
    throw new Error('year out of range')
  }
  const from = `${year}-01-01`
  const to = `${year}-12-31`
  const deleted = await db
    .delete(workCalendar)
    .where(and(gte(workCalendar.date, from), lte(workCalendar.date, to)))
    .returning({ d: workCalendar.date })
  return deleted.length
}

/** Years that already have at least one row, for the picker. */
export async function listInitializedYears(db: AnyDb): Promise<number[]> {
  const rows = await db.execute(sql`
    SELECT DISTINCT EXTRACT(YEAR FROM date)::int AS year
      FROM work_calendar
     ORDER BY year DESC
  `)
  return (rows as unknown as Array<{ year: number }>).map((r) => r.year)
}

/** Shape used by the `/calendar/initialize` API; the wizard sends this. */
export async function getShiftsForInitialization(
  db: AnyDb,
  shiftIds: string[]
): Promise<Array<{ id: string; weekdays: number[] }>> {
  if (shiftIds.length === 0) return []
  const { shifts } = await import('@payroll/db')
  const { inArray } = await import('drizzle-orm')
  return db
    .select({ id: shifts.id, weekdays: shifts.weekdays })
    .from(shifts)
    .where(inArray(shifts.id, shiftIds))
}
