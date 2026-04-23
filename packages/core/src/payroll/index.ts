export type {
  ProcessLineInput,
  ProcessLineResult,
  ConceptInput,
  AttendanceInput,
  LineConceptEntry,
  OtherDiscountRef,
} from './engine'
export { processLine } from './engine'
export { countBusinessDays, countCalendarDays, round2 } from './utils'
export type { ThirteenthPeriod, ThirteenthPeriodNumber } from './thirteenth'
export {
  calcThirteenthDaysWorked,
  determinarPeriodoTrimestral,
  getThirteenthPeriods,
  thirteenthProportionFactor,
} from './thirteenth'
