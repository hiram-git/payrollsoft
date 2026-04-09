import type { FormulaContext } from '../types'

type DiasTipo = 'TRABAJADOS' | 'HABILES' | 'AUSENCIA' | 'PERIODO' | 'TARDANZA' | 'EXTRA'

/**
 * DIAS("tipo")
 * Returns a number of days (or minutes for TARDANZA/EXTRA) from the attendance context.
 *
 * Types:
 *   TRABAJADOS  — actual worked days (from attendance records)
 *   HABILES     — business days in the period (Mon–Fri, excluding holidays)
 *   AUSENCIA    — absence days
 *   PERIODO     — total calendar days in the payroll period
 *   TARDANZA    — late minutes
 *   EXTRA       — overtime minutes
 */
export async function DIAS(args: (number | string)[], ctx: FormulaContext): Promise<number> {
  const tipo = String(args[0] ?? 'PERIODO').toUpperCase() as DiasTipo

  switch (tipo) {
    case 'TRABAJADOS':
      return ctx.attendance.workedDays
    case 'HABILES':
      return ctx.attendance.businessDays
    case 'AUSENCIA':
      return ctx.attendance.absenceDays
    case 'PERIODO':
      return ctx.period.totalDays
    case 'TARDANZA':
      return ctx.attendance.lateMinutes
    case 'EXTRA':
      return ctx.attendance.overtimeMinutes
    default:
      throw new Error(
        `DIAS(): unknown type '${tipo}'. Use TRABAJADOS, HABILES, AUSENCIA, PERIODO, TARDANZA, or EXTRA.`
      )
  }
}
