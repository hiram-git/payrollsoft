import type { FormulaContext } from '../types'

/**
 * CUOTA_ACREEDOR("CODE") — Loan installment sum for a given creditor in the current period.
 *
 * Equivalent to the PHP function cuota_prestamo_acreedor(ficha, fechaInicio, fechaFin, acreedorId).
 * Employee and period are taken from the formula context; only the creditor code is required.
 *
 * Example in a concept formula:
 *   CUOTA_ACREEDOR("BPNSA")
 *
 * Returns 0 when:
 *  - The creditor code doesn't exist in the catalog
 *  - The employee has no active loans linked to that creditor for the period
 */
export async function CUOTA_ACREEDOR(
  args: (number | string)[],
  ctx: FormulaContext
): Promise<number> {
  if (args.length < 1) {
    throw new Error('CUOTA_ACREEDOR() requires one argument: creditor code')
  }
  const creditorCode = String(args[0]).toUpperCase()
  const periodStart = ctx.period.start.toISOString().slice(0, 10)
  const periodEnd = ctx.period.end.toISOString().slice(0, 10)
  return ctx.loadInstallmentsByCreditor(creditorCode, periodStart, periodEnd)
}
