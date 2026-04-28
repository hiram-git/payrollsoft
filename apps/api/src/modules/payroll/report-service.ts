import {
  findUserById,
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
  /** Resolved generator details for the report footer. Null when no
   *  user has generated the report yet, or when the recorded user id
   *  no longer exists. */
  generatedByName: string | null
  generatedByEmail: string | null
}

async function resolveGenerator(
  db: AnyDb,
  userId: string | null
): Promise<{ name: string | null; email: string | null }> {
  if (!userId) return { name: null, email: null }
  try {
    const user = await findUserById(db, userId)
    if (!user) return { name: null, email: null }
    return { name: user.name ?? null, email: user.email ?? null }
  } catch {
    return { name: null, email: null }
  }
}

async function toState(
  db: AnyDb,
  row: Awaited<ReturnType<typeof getPayrollReport>>
): Promise<PayrollReportState> {
  if (!row) {
    return {
      status: 'not_generated',
      pdfPath: null,
      generatedAt: null,
      updatedAt: null,
      generatedBy: null,
      generatedByName: null,
      generatedByEmail: null,
    }
  }
  const generator = await resolveGenerator(db, row.generatedBy ?? null)
  return {
    status: row.status === 'generated' ? 'generated' : 'not_generated',
    pdfPath: row.pdfPath ?? null,
    generatedAt: row.generatedAt ? row.generatedAt.toISOString() : null,
    updatedAt: row.updatedAt ? row.updatedAt.toISOString() : null,
    generatedBy: row.generatedBy ?? null,
    generatedByName: generator.name,
    generatedByEmail: generator.email,
  }
}

export async function getPayrollReportService(db: AnyDb, payrollId: string) {
  const payroll = await getPayroll(db, payrollId)
  if (!payroll) return { success: false as const, error: 'not_found' }
  const row = await getPayrollReport(db, payrollId)
  return { success: true as const, data: await toState(db, row) }
}

export async function markPayrollReportGeneratedService(
  db: AnyDb,
  input: { payrollId: string; pdfPath: string | null; generatedBy?: string | null }
) {
  const payroll = await getPayroll(db, input.payrollId)
  if (!payroll) return { success: false as const, error: 'not_found' }
  const row = await markPayrollReportGenerated(db, input)
  return { success: true as const, data: await toState(db, row) }
}

export async function markPayrollReportNotGeneratedService(db: AnyDb, payrollId: string) {
  const payroll = await getPayroll(db, payrollId)
  if (!payroll) return { success: false as const, error: 'not_found' }
  const row = await markPayrollReportNotGenerated(db, payrollId)
  // If no row existed, still return the initial state — idempotent from the caller's PoV.
  return { success: true as const, data: await toState(db, row) }
}
