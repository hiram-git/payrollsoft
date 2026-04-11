/**
 * Count business days (Mon–Fri) between two dates, inclusive.
 */
export function countBusinessDays(start: Date, end: Date): number {
  let count = 0
  const cur = new Date(start)
  cur.setHours(0, 0, 0, 0)
  const endNorm = new Date(end)
  endNorm.setHours(0, 0, 0, 0)

  while (cur <= endNorm) {
    const day = cur.getDay()
    if (day !== 0 && day !== 6) count++
    cur.setDate(cur.getDate() + 1)
  }
  return count
}

/**
 * Count calendar days between two dates, inclusive.
 */
export function countCalendarDays(start: Date, end: Date): number {
  const ms = end.getTime() - start.getTime()
  return Math.round(ms / (1000 * 60 * 60 * 24)) + 1
}

/**
 * Round a number to 2 decimal places.
 */
export function round2(n: number): number {
  return Math.round(n * 100) / 100
}
