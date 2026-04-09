import type { FormulaContext } from '../types'

/** Returns the day-of-month of the payroll period start date (e.g. 1 or 16). */
export async function INIPERIODO(_args: (number | string)[], ctx: FormulaContext): Promise<number> {
  return ctx.period.start.getDate()
}

/** Returns the day-of-month of the payroll period end date (e.g. 15 or 31). */
export async function FINPERIODO(_args: (number | string)[], ctx: FormulaContext): Promise<number> {
  return ctx.period.end.getDate()
}

/**
 * MESPERIODO() — returns the month number (1–12) of the payroll period.
 * Useful for XIII Month semester logic.
 */
export async function MESPERIODO(_args: (number | string)[], ctx: FormulaContext): Promise<number> {
  return ctx.period.start.getMonth() + 1
}

/**
 * ANIOPERIODO() — returns the year of the payroll period.
 */
export async function ANIOPERIODO(
  _args: (number | string)[],
  ctx: FormulaContext
): Promise<number> {
  return ctx.period.start.getFullYear()
}
