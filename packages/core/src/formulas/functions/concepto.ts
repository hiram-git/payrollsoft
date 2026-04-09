import type { FormulaContext } from '../types'

/**
 * CONCEPTO("codigo")
 * Returns the calculated value of a payroll concept within the current payroll line.
 * Returns 0 if the concept is not present.
 */
export async function CONCEPTO(args: (number | string)[], ctx: FormulaContext): Promise<number> {
  if (args.length < 1) throw new Error('CONCEPTO() requires a concept code argument')
  const code = String(args[0]).toUpperCase()
  return ctx.concepts[code] ?? 0
}
