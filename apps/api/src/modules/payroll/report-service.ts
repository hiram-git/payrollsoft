import {
  getPayroll,
  getPayrollReport,
  markPayrollReportGenerated,
  markPayrollReportNotGenerated,
} from '@payroll/db'

// biome-ignore lint/suspicious/noExplicitAny: generic DB type shared across modules
type AnyDb = any

export type PayrollReportState = {
  status: 'not_generated' | 'generated'
  pdfPath: string | null
  generatedAt: string | null
  updatedAt: string | null
  generatedBy: string | null
}

function toState(row: Awaited<ReturnType<typeof getPayrollReport>>): PayrollReportState {
  if (!row) {
    return {
      status: 'not_generated',
      pdfPath: null,
      generatedAt: null,
      updatedAt: null,
      generatedBy: null,
    }
  }
  return {
    status: row.status === 'generated' ? 'generated' : 'not_generated',
    pdfPath: row.pdfPath ?? null,
    generatedAt: row.generatedAt ? row.generatedAt.toISOString() : null,
    updatedAt: row.updatedAt ? row.updatedAt.toISOString() : null,
    generatedBy: row.generatedBy ?? null,
  }
}

export async function getPayrollReportService(db: AnyDb, payrollId: string) {
  const payroll = await getPayroll(db, payrollId)
  if (!payroll) return { success: false as const, error: 'not_found' }
  const row = await getPayrollReport(db, payrollId)
  return { success: true as const, data: toState(row) }
}

export async function markPayrollReportGeneratedService(
  db: AnyDb,
  input: { payrollId: string; pdfPath: string | null; generatedBy?: string | null }
) {
  const payroll = await getPayroll(db, input.payrollId)
  if (!payroll) return { success: false as const, error: 'not_found' }
  const row = await markPayrollReportGenerated(db, input)
  return { success: true as const, data: toState(row) }
}

export async function markPayrollReportNotGeneratedService(db: AnyDb, payrollId: string) {
  const payroll = await getPayroll(db, payrollId)
  if (!payroll) return { success: false as const, error: 'not_found' }
  const row = await markPayrollReportNotGenerated(db, payrollId)
  // If no row existed, still return the initial state — idempotent from the caller's PoV.
  return { success: true as const, data: toState(row) }
}
