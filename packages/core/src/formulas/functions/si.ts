import type { FormulaContext } from '../types'

/**
 * SI(condicion, valor_si_verdadero, valor_si_falso)
 * Equivalent to Excel's IF().
 * Condition is truthy when != 0.
 */
export async function SI(args: (number | string)[], _ctx: FormulaContext): Promise<number> {
  if (args.length !== 3) throw new Error(`SI() expects 3 arguments, got ${args.length}`)
  const [condition, ifTrue, ifFalse] = args
  return Number(condition) !== 0 ? Number(ifTrue) : Number(ifFalse)
}
