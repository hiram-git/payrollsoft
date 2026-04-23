import { FormulaEngine } from '../formulas/engine'
import type { FormulaContext } from '../formulas/types'
import { round2 } from './utils'

// ─── Input / Output Types ─────────────────────────────────────────────────────

export type ConceptInput = {
  code: string
  name: string
  type: 'income' | 'deduction'
  formula: string | null
  /** When false, skip this concept from the line if its evaluated amount is zero. */
  allowZero?: boolean
}

export type AttendanceInput = {
  workedDays: number
  businessDays: number
  lateMinutes: number
  overtimeMinutes: number
  absenceDays: number
}

export type ProcessLineInput = {
  employee: {
    id: string
    code: string
    baseSalary: number
    hireDate: Date
    customFields?: Record<string, unknown>
  }
  period: {
    start: Date
    end: Date
    totalDays: number
    type: 'biweekly' | 'monthly' | 'weekly'
  }
  payroll?: {
    paymentDate: string | null
  }
  attendance: AttendanceInput
  /** Active concepts, income first then deductions — order matters for CONCEPTO() references */
  concepts: ConceptInput[]
  /** Total loan installment amount to deduct for this employee this period */
  loanInstallments: number
  loadAccumulated: (code: string, periods: number) => Promise<number>
  loadAccumulatedByDateRange: (code: string, from: string, to: string) => Promise<number>
  loadBalance: (type: string) => Promise<number>
  loadInstallmentsByCreditor: (creditorCode: string, from: string, to: string) => Promise<number>
}

/**
 * Denormalised reference stamped on creditor-linked deduction entries. Lets
 * report readers find the underlying loan(s) and creditor without joining
 * loans / creditors back in at query time.
 */
export type OtherDiscountRef = {
  loan_ids: string[]
  creditor_id: string
  creditor_code: string
  creditor_name: string
}

export type LineConceptEntry = {
  code: string
  name: string
  type: 'income' | 'deduction'
  amount: number
  formulaError?: string
  /** Populated for `ACR_*` (creditor) deductions by the payroll service. */
  other_discounts?: OtherDiscountRef
}

export type ProcessLineResult = {
  grossAmount: number
  deductions: number
  netAmount: number
  concepts: LineConceptEntry[]
  warnings: string[]
}

// ─── Engine ───────────────────────────────────────────────────────────────────

const sharedEngine = new FormulaEngine()

/**
 * Process a single payroll line for one employee.
 *
 * Concepts are evaluated in the provided order (income first, then deductions).
 * Each evaluated concept is immediately available to subsequent concepts via
 * CONCEPTO("CODE") in their formulas.
 *
 * Concepts with no formula produce amount = 0 (manual entry).
 */
export async function processLine(input: ProcessLineInput): Promise<ProcessLineResult> {
  const resolvedConcepts: Record<string, number> = {}
  const entries: LineConceptEntry[] = []
  const warnings: string[] = []

  const ctx: FormulaContext = {
    employee: {
      id: input.employee.id,
      code: input.employee.code,
      baseSalary: input.employee.baseSalary,
      hireDate: input.employee.hireDate,
      customFields: input.employee.customFields,
    },
    period: input.period,
    payroll: input.payroll,
    attendance: input.attendance,
    concepts: resolvedConcepts,
    loadAccumulated: input.loadAccumulated,
    loadAccumulatedByDateRange: input.loadAccumulatedByDateRange,
    loadBalance: input.loadBalance,
    loadInstallmentsByCreditor: input.loadInstallmentsByCreditor,
  }

  for (const concept of input.concepts) {
    let amount = 0
    let formulaError: string | undefined

    if (concept.formula?.trim()) {
      const result = await sharedEngine.evaluate(concept.formula, ctx)
      if (result.error) {
        formulaError = result.error
        warnings.push(`[${concept.code}] ${result.error}`)
        amount = 0
      } else {
        amount = round2(result.value)
      }
    }

    // Make this concept's value available to later concepts regardless of zero filtering
    resolvedConcepts[concept.code] = amount

    // Skip zero-amount concepts when the concept explicitly disallows zeros
    if (amount === 0 && concept.allowZero === false) continue

    entries.push({
      code: concept.code,
      name: concept.name,
      type: concept.type,
      amount,
      formulaError,
    })
  }

  // Loan installments as a special deduction entry
  if (input.loanInstallments > 0) {
    const installment = round2(input.loanInstallments)
    entries.push({
      code: 'PRESTAMO',
      name: 'Cuota de préstamo',
      type: 'deduction',
      amount: installment,
    })
  }

  const grossAmount = round2(
    entries.filter((e) => e.type === 'income').reduce((s, e) => s + e.amount, 0)
  )
  const deductions = round2(
    entries.filter((e) => e.type === 'deduction').reduce((s, e) => s + e.amount, 0)
  )
  const netAmount = round2(grossAmount - deductions)

  return { grossAmount, deductions, netAmount, concepts: entries, warnings }
}
