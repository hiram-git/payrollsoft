import {
  closeLoan,
  createLoan,
  getEmployee,
  getLoanById,
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
}

export function listLoansService(db: AnyDb, employeeId: string) {
  return listLoansByEmployee(db, employeeId)
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
  })
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
