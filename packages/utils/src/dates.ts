import {
  addDays,
  differenceInCalendarDays,
  endOfMonth,
  format,
  isWeekend,
  parseISO,
  startOfMonth,
} from 'date-fns'

// Panama timezone offset — UTC-5 (no DST)
const PANAMA_TZ = 'America/Panama'

export function formatPanama(date: Date, pattern = 'dd/MM/yyyy'): string {
  return format(date, pattern)
}

export function parseDate(dateStr: string): Date {
  return parseISO(dateStr)
}

/**
 * Count working days between two dates (excluding weekends).
 * Panama public holidays are not automatically excluded here —
 * pass holidayDates to subtract them.
 */
export function countWorkingDays(start: Date, end: Date, holidayDates: Date[] = []): number {
  const holidaySet = new Set(holidayDates.map((d) => format(d, 'yyyy-MM-dd')))
  let count = 0
  let current = start

  while (current <= end) {
    const key = format(current, 'yyyy-MM-dd')
    if (!isWeekend(current) && !holidaySet.has(key)) {
      count++
    }
    current = addDays(current, 1)
  }

  return count
}

/**
 * Calculate vacation days earned under Panama Labor Code.
 * Rule: 1 day per every 11 calendar days worked, up to 30 days/year.
 */
export function calcVacationDaysEarned(calendarDaysWorked: number): number {
  return Math.min(Math.floor(calendarDaysWorked / 11), 30)
}

/**
 * Returns the biweekly periods for a given month.
 * Period 1: 1st–15th, Period 2: 16th–last day.
 */
export function getBiweeklyPeriods(year: number, month: number) {
  const first = new Date(year, month - 1, 1)
  const mid = new Date(year, month - 1, 15)
  const last = endOfMonth(first)

  return [
    { start: first, end: mid },
    { start: addDays(mid, 1), end: last },
  ]
}

/**
 * Returns the XIII Month semester periods for a given year.
 * Semester 1: Jan 1 – Jun 30 (paid in April)
 * Semester 2: Jul 1 – Dec 31 (paid in December)
 */
export function getThirteenthMonthPeriods(year: number) {
  return [
    {
      semester: 1,
      start: new Date(year, 0, 1),
      end: new Date(year, 5, 30),
      paymentMonth: 'April',
    },
    {
      semester: 2,
      start: new Date(year, 6, 1),
      end: new Date(year, 11, 31),
      paymentMonth: 'December',
    },
  ]
}
