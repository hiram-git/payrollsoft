import type { FormulaContext } from '../types'

/**
 * ACUMULADOS — Accumulated concept query
 *
 * Signature variants:
 *
 *   ACUMULADOS("CODE", N)
 *     → Sum of concept CODE over the last N closed payrolls (existing behavior).
 *     Example: ACUMULADOS("INGRESO_BRUTO", 6)
 *
 *   ACUMULADOS("CODE", DESDE, HASTA)
 *     → Sum of concept CODE across closed payrolls whose period falls within
 *       [DESDE, HASTA]. Dates may be YYYYMMDD integers or "YYYY-MM-DD" strings.
 *     Example: ACUMULADOS("SUELDO", FECHAINICIO, FECHAFIN)
 *
 *   ACUMULADOS("CODE", FICHA, DESDE, HASTA)
 *     → PHP-compatible 4-arg form. FICHA is accepted but ignored (the current
 *       employee from context is always used).
 *     Example: ACUMULADOS("SALARIO_BASE", FICHA, INICIO_PERIODO_XIII, FIN_PERIODO_XIII)
 */
export async function ACUMULADOS(args: (number | string)[], ctx: FormulaContext): Promise<number> {
  if (args.length < 2) throw new Error('ACUMULADOS() requires at least 2 arguments: code, periods')

  // Support comma-separated codes: "SALARIO_BASE,HORAS_EXTRAS,COMISIONES"
  const codes = String(args[0])
    .toUpperCase()
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean)

  // 4-arg PHP-compat: ACUMULADOS("CODE[,CODE2]", FICHA, FROM, TO) — FICHA ignored
  if (args.length >= 4) {
    const from = toDateStr(args[2])
    const to = toDateStr(args[3])
    const totals = await Promise.all(codes.map((c) => ctx.loadAccumulatedByDateRange(c, from, to)))
    return totals.reduce((a, b) => a + b, 0)
  }

  // 3-arg date range: ACUMULADOS("CODE[,CODE2]", FROM, TO)
  if (args.length === 3) {
    const from = toDateStr(args[1])
    const to = toDateStr(args[2])
    const totals = await Promise.all(codes.map((c) => ctx.loadAccumulatedByDateRange(c, from, to)))
    return totals.reduce((a, b) => a + b, 0)
  }

  // 2-arg last-N form: ACUMULADOS("CODE", N) — single code only
  if (codes.length > 1)
    throw new Error('ACUMULADOS() with multiple codes requires a date range (3 or 4 arguments)')
  const periods = Math.max(1, Math.floor(Number(args[1])))
  return ctx.loadAccumulated(codes[0], periods)
}

/**
 * Convert a YYYYMMDD integer (e.g. 20240415) or an already-formatted
 * "YYYY-MM-DD" string to a canonical "YYYY-MM-DD" date string.
 */
function toDateStr(v: number | string): string {
  const s = String(v).replace(/\D/g, '')
  if (s.length === 8) {
    return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`
  }
  // Already a date string or unrecognized → return as-is
  return String(v)
}
