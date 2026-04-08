import type { FormulaContext } from '../types'

/** REDONDEAR(valor, decimales) — Round to N decimal places */
export async function REDONDEAR(args: (number | string)[], _ctx: FormulaContext): Promise<number> {
  if (args.length < 1) throw new Error('REDONDEAR() requires at least 1 argument')
  const value = Number(args[0])
  const decimals = Math.floor(Number(args[1] ?? 2))
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

/** TRUNCAR(valor, decimales) — Truncate to N decimal places (no rounding) */
export async function TRUNCAR(args: (number | string)[], _ctx: FormulaContext): Promise<number> {
  if (args.length < 1) throw new Error('TRUNCAR() requires at least 1 argument')
  const value = Number(args[0])
  const decimals = Math.floor(Number(args[1] ?? 0))
  const factor = 10 ** decimals
  return Math.trunc(value * factor) / factor
}

/** ABS(valor) — Absolute value */
export async function ABS(args: (number | string)[], _ctx: FormulaContext): Promise<number> {
  if (args.length < 1) throw new Error('ABS() requires 1 argument')
  return Math.abs(Number(args[0]))
}

/** MAX(a, b) — Maximum of two values */
export async function MAX(args: (number | string)[], _ctx: FormulaContext): Promise<number> {
  if (args.length < 2) throw new Error('MAX() requires 2 arguments')
  return Math.max(Number(args[0]), Number(args[1]))
}

/** MIN(a, b) — Minimum of two values */
export async function MIN(args: (number | string)[], _ctx: FormulaContext): Promise<number> {
  if (args.length < 2) throw new Error('MIN() requires 2 arguments')
  return Math.min(Number(args[0]), Number(args[1]))
}
