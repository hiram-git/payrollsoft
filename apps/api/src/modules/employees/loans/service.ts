import {
  closeLoan,
  createLoan,
  createLoanInstallments,
  getEmployee,
  getLoanById,
  listAllLoans,
  listLoansByEmployee,
  updateLoan,
} from '@payroll/db'

// biome-ignore lint/suspicious/noExplicitAny: intentional generic DB type
type AnyDb = any

export type LoanInput = {
  employeeId: string
  amount: string
  balance: string
  installment: string
  startDate: string
  endDate?: string | null
  loanType?: string | null
  frequency?: string | null
  creditor?: string | null
  creditorId?: string | null
  allowDecember?: boolean
}

export function listLoansService(db: AnyDb, employeeId: string) {
  return listLoansByEmployee(db, employeeId)
}

export function listAllLoansService(db: AnyDb, filter: { isActive?: boolean }) {
  return listAllLoans(db, filter)
}

export function getLoanService(db: AnyDb, id: string) {
  return getLoanById(db, id)
}

export async function createLoanService(db: AnyDb, input: LoanInput) {
  const emp = await getEmployee(db, input.employeeId)
  if (!emp) {
    return { success: false as const, error: 'employee_not_found', message: 'Employee not found' }
  }
  const row = await createLoan(db, {
    employeeId: input.employeeId,
    amount: input.amount,
    balance: input.balance,
    installment: input.installment,
    startDate: input.startDate,
    endDate: input.endDate ?? null,
    loanType: input.loanType ?? null,
    frequency: input.frequency ?? null,
    creditor: input.creditor ?? null,
    creditorId: input.creditorId ?? null,
    allowDecember: input.allowDecember ?? true,
  })

  // Generate installment schedule
  const totalAmount = Number(input.amount)
  const installmentAmount = Number(input.installment)
  if (installmentAmount > 0 && totalAmount > 0) {
    const count = Math.ceil(totalAmount / installmentAmount)
    const installments = Array.from({ length: count }, (_, i) => {
      const isLast = i === count - 1
      const remainder = totalAmount - installmentAmount * (count - 1)
      return {
        loanId: row.id,
        installmentNumber: i + 1,
        amount: String(isLast ? Math.min(installmentAmount, remainder) : installmentAmount),
      }
    })
    await createLoanInstallments(db, installments)
  }

  return { success: true as const, data: row }
}

export type LoanUpdateInput = Partial<Omit<LoanInput, 'employeeId'>>

export async function updateLoanService(db: AnyDb, id: string, input: LoanUpdateInput) {
  const existing = await getLoanById(db, id)
  if (!existing) {
    return { success: false as const, error: 'not_found', message: 'Loan not found' }
  }
  const patch: Record<string, unknown> = {}
  if (input.amount !== undefined) patch.amount = input.amount
  if (input.balance !== undefined) patch.balance = input.balance
  if (input.installment !== undefined) patch.installment = input.installment
  if (input.startDate !== undefined) patch.startDate = input.startDate
  if (input.endDate !== undefined) patch.endDate = input.endDate ?? null
  if (input.loanType !== undefined) patch.loanType = input.loanType ?? null
  if (input.frequency !== undefined) patch.frequency = input.frequency ?? null
  if (input.creditor !== undefined) patch.creditor = input.creditor ?? null
  if (input.allowDecember !== undefined) patch.allowDecember = input.allowDecember
  const row = await updateLoan(db, id, patch)
  return { success: true as const, data: row }
}

export async function closeLoanService(db: AnyDb, id: string) {
  const existing = await getLoanById(db, id)
  if (!existing) {
    return { success: false as const, error: 'not_found', message: 'Loan not found' }
  }
  const row = await closeLoan(db, id)
  return { success: true as const, data: row }
}
