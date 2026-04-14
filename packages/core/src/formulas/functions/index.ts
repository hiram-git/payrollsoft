import type { FormulaContext } from '../types'
import { ACUMULADOS } from './acumulados'
import { CONCEPTO } from './concepto'
import { CUOTA_ACREEDOR } from './cuota'
import { DIAS } from './dias'
import { ABS, MAX, MIN, REDONDEAR, TRUNCAR } from './math'
import { ANIOPERIODO, FINPERIODO, INIPERIODO, MESPERIODO } from './periodo'
import { SALDO } from './saldo'
import { SI } from './si'

export type FunctionHandler = (args: (number | string)[], ctx: FormulaContext) => Promise<number>

/**
 * Registry of all built-in formula functions.
 * Keys are the uppercased function names used in formulas.
 */
export const FUNCTIONS: Record<string, FunctionHandler> = {
  // Control flow
  SI,

  // Payroll concepts
  CONCEPTO,

  // Attendance & days
  DIAS,

  // Period info
  INIPERIODO,
  FINPERIODO,
  MESPERIODO,
  ANIOPERIODO,

  // Accumulated & balances (DB-backed via context loaders)
  ACUMULADOS,
  SALDO,

  // Creditor loan installments
  CUOTA_ACREEDOR,

  // Math utilities
  REDONDEAR,
  TRUNCAR,
  ABS,
  MAX,
  MIN,
}
