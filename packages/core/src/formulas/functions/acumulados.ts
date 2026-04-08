import type { FormulaContext } from '../types'

/**
 * ACUMULADOS("codigo", n_periodos)
 * Returns the sum of a payroll concept across the last N payroll periods
 * (including the current period if already processed).
 *
 * The actual DB lookup is delegated to `ctx.loadAccumulated`, which is
 * implemented in the API layer (Phase 3). This keeps the engine pure.
 *
 * Example:
 *   ACUMULADOS("INGRESO_BRUTO", 6)  → sum of gross income over last 6 payrolls
 *   ACUMULADOS("XIII_ACUMULADO", 1) → XIII month accumulated in current semester
 */
export async function ACUMULADOS(args: (number | string)[], ctx: FormulaContext): Promise<number> {
  if (args.length < 2) throw new Error('ACUMULADOS() requires 2 arguments: code, periods')
  const code = String(args[0]).toUpperCase()
  const periods = Math.max(1, Math.floor(Number(args[1])))
  return ctx.loadAccumulated(code, periods)
}
