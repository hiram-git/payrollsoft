/**
 * Pure calculation helpers for the time-balance ledger.
 *
 * A balance's available minutes is the sum of all its movements'
 * `amountMinutes` (credits positive, debits negative). Nothing is stored —
 * callers pass the movement rows and get the computed totals back.
 */

export const MINUTES_PER_HOUR = 60
export const ANNUAL_HOURS = 144
export const ANNUAL_MINUTES = ANNUAL_HOURS * MINUTES_PER_HOUR // 8640

export interface MovementInput {
  amountMinutes: number
}

export interface BalanceSummary {
  /** Sum of positive movements (initialization, credits, positive adjustments). */
  creditedMinutes: number
  /** Absolute sum of negative movements (debits, negative adjustments). */
  debitedMinutes: number
  /** Net available minutes = credited - debited (may be negative). */
  availableMinutes: number
}

/**
 * Compute a balance summary from its movement rows.
 */
export function summarizeMovements(movements: readonly MovementInput[]): BalanceSummary {
  let credited = 0
  let debited = 0
  for (const m of movements) {
    const amt = m.amountMinutes
    if (amt >= 0) credited += amt
    else debited += -amt
  }
  return {
    creditedMinutes: credited,
    debitedMinutes: debited,
    availableMinutes: credited - debited,
  }
}

/**
 * Net available minutes for a set of movements.
 */
export function computeAvailableMinutes(movements: readonly MovementInput[]): number {
  let total = 0
  for (const m of movements) total += m.amountMinutes
  return total
}

/**
 * Whether a debit of `requestedMinutes` is allowed given the current
 * available minutes and the negative-balance policy.
 *
 * Policy "permitir con autorización": by default a debit that would push the
 * balance below zero is rejected; passing `allowNegative` (granted by the
 * `time_balance:override` permission) lets it through.
 */
export function canDebit(
  availableMinutes: number,
  requestedMinutes: number,
  allowNegative = false
): boolean {
  if (requestedMinutes <= 0) return false
  if (allowNegative) return true
  return availableMinutes - requestedMinutes >= 0
}

export function minutesToHours(minutes: number): number {
  return Math.round((minutes / MINUTES_PER_HOUR) * 100) / 100
}

export function hoursToMinutes(hours: number): number {
  return Math.round(hours * MINUTES_PER_HOUR)
}
