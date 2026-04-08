import type { FormulaContext } from '../types'

/**
 * SALDO("tipo")
 * Returns the current balance of a specific item for the employee.
 *
 * Common types:
 *   PRESTAMO    — current loan balance (sum of remaining installments)
 *   VACACIONES  — vacation days balance
 *
 * The actual DB lookup is delegated to `ctx.loadBalance` (implemented in Phase 3).
 *
 * Example:
 *   SALDO("PRESTAMO")    → 250.00  (remaining loan balance in dollars)
 *   SALDO("VACACIONES")  → 12      (vacation days available)
 */
export async function SALDO(args: (number | string)[], ctx: FormulaContext): Promise<number> {
  if (args.length < 1) throw new Error('SALDO() requires a type argument')
  const tipo = String(args[0]).toUpperCase()
  return ctx.loadBalance(tipo)
}
