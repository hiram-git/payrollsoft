import { countBusinessDays, countCalendarDays, processLine, round2 } from '@payroll/core'
import {
  createPayroll,
  deleteDraftPayroll,
  getAttendanceSummaryForPeriod,
  getPayroll,
  getPayrollLines,
  listConcepts,
  listEmployees,
  listLoansByEmployee,
  listPayrolls,
  loadAccumulated,
  updatePayroll,
  upsertPayrollLine,
} from '@payroll/db'

// biome-ignore lint/suspicious/noExplicitAny: intentional generic DB type
type AnyDb = any

export type CreatePayrollInput = {
  name: string
  type: string
  frequency: string
  periodStart: string
  periodEnd: string
  paymentDate?: string | null
}

// ─── Queries ──────────────────────────────────────────────────────────────────

export function listPayrollsService(
  db: AnyDb,
  filter: { status?: string; type?: string; year?: number } = {}
) {
  return listPayrolls(db, filter, { limit: 50 })
}

export async function getPayrollService(db: AnyDb, id: string) {
  const [payroll, lines] = await Promise.all([getPayroll(db, id), getPayrollLines(db, id)])
  if (!payroll) return null
  return { payroll, lines }
}

// ─── Mutations ────────────────────────────────────────────────────────────────

export async function createPayrollService(db: AnyDb, input: CreatePayrollInput) {
  const validTypes = ['regular', 'thirteenth', 'special']
  const validFreqs = ['biweekly', 'monthly', 'weekly']

  if (!validTypes.includes(input.type)) {
    return { success: false as const, error: 'invalid_type', message: 'Invalid payroll type' }
  }
  if (!validFreqs.includes(input.frequency)) {
    return { success: false as const, error: 'invalid_freq', message: 'Invalid frequency' }
  }
  if (input.periodStart >= input.periodEnd) {
    return {
      success: false as const,
      error: 'invalid_period',
      message: 'periodStart must be before periodEnd',
    }
  }

  const row = await createPayroll(db, {
    name: input.name.trim(),
    type: input.type,
    frequency: input.frequency,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    paymentDate: input.paymentDate ?? null,
    status: 'draft',
  })
  return { success: true as const, data: row }
}

export async function updatePayrollService(
  db: AnyDb,
  id: string,
  input: Partial<CreatePayrollInput>
) {
  const existing = await getPayroll(db, id)
  if (!existing)
    return { success: false as const, error: 'not_found', message: 'Payroll not found' }
  if (existing.status !== 'draft') {
    return {
      success: false as const,
      error: 'not_editable',
      message: 'Only draft payrolls can be edited',
    }
  }
  const patch: Record<string, unknown> = {}
  if (input.name !== undefined) patch.name = input.name.trim()
  if (input.paymentDate !== undefined) patch.paymentDate = input.paymentDate ?? null
  const row = await updatePayroll(db, id, patch)
  return { success: true as const, data: row }
}

export async function deletePayrollService(db: AnyDb, id: string) {
  const existing = await getPayroll(db, id)
  if (!existing)
    return { success: false as const, error: 'not_found', message: 'Payroll not found' }
  if (existing.status !== 'draft') {
    return {
      success: false as const,
      error: 'not_deletable',
      message: 'Only draft payrolls can be deleted',
    }
  }
  await deleteDraftPayroll(db, id)
  return { success: true as const }
}

// ─── Payroll Processing ───────────────────────────────────────────────────────

export async function processPayrollService(db: AnyDb, id: string) {
  const payroll = await getPayroll(db, id)
  if (!payroll) return { success: false as const, error: 'not_found', message: 'Payroll not found' }
  if (payroll.status !== 'draft') {
    return {
      success: false as const,
      error: 'not_draft',
      message: 'Only draft payrolls can be processed',
    }
  }

  await updatePayroll(db, id, { status: 'processing' })

  try {
    const [employeeResult, allConcepts] = await Promise.all([
      listEmployees(db, { isActive: true }, { limit: 1000 }),
      listConcepts(db),
    ])

    // Income first, then deductions — enables CONCEPTO() forward references within type
    const activeConcepts = allConcepts
      .filter((c) => c.isActive)
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === 'income' ? -1 : 1
        return a.code.localeCompare(b.code)
      })

    const periodStart = new Date(payroll.periodStart)
    const periodEnd = new Date(payroll.periodEnd)
    const totalDays = countCalendarDays(periodStart, periodEnd)
    const totalBusinessDays = countBusinessDays(periodStart, periodEnd)

    let totalGross = 0
    let totalDeductions = 0
    const allWarnings: string[] = []

    for (const emp of employeeResult.data) {
      // Attendance for the period
      const att = await getAttendanceSummaryForPeriod(
        db,
        emp.id,
        payroll.periodStart,
        payroll.periodEnd
      )

      const workedDays = att.recordCount > 0 ? att.daysWithRecords : totalBusinessDays // no records → full period assumed

      const absenceDays = Math.max(0, totalBusinessDays - workedDays)

      // Active loans applicable to this period
      const empLoans = await listLoansByEmployee(db, emp.id)
      const loanInstallments = empLoans
        .filter(
          (l) =>
            l.isActive &&
            l.startDate <= payroll.periodEnd &&
            (l.endDate === null || l.endDate >= payroll.periodStart)
        )
        .reduce((sum, l) => sum + Number(l.installment), 0)

      const result = await processLine({
        employee: {
          id: emp.id,
          baseSalary: Number(emp.baseSalary),
          hireDate: new Date(emp.hireDate),
        },
        period: {
          start: periodStart,
          end: periodEnd,
          totalDays,
          type: payroll.frequency as 'biweekly' | 'monthly' | 'weekly',
        },
        attendance: {
          workedDays,
          businessDays: totalBusinessDays,
          lateMinutes: att.lateMinutes,
          overtimeMinutes: att.overtimeMinutes,
          absenceDays,
        },
        concepts: activeConcepts.map((c) => ({
          code: c.code,
          name: c.name,
          type: c.type as 'income' | 'deduction',
          formula: c.formula,
        })),
        loanInstallments,
        loadAccumulated: (code, periods) => loadAccumulated(db, emp.id, code, periods),
        loadBalance: async () => 0, // vacation balance — Phase 3f
      })

      if (result.warnings.length > 0) {
        allWarnings.push(...result.warnings.map((w) => `${emp.code}: ${w}`))
      }

      await upsertPayrollLine(db, {
        payrollId: id,
        employeeId: emp.id,
        grossAmount: String(result.grossAmount),
        deductions: String(result.deductions),
        netAmount: String(result.netAmount),
        concepts: result.concepts,
      })

      totalGross += result.grossAmount
      totalDeductions += result.deductions
    }

    const totalNet = round2(totalGross - totalDeductions)
    await updatePayroll(db, id, {
      status: 'processed',
      totalGross: String(round2(totalGross)),
      totalDeductions: String(round2(totalDeductions)),
      totalNet: String(totalNet),
    })

    return {
      success: true as const,
      data: {
        processedEmployees: employeeResult.data.length,
        totalGross: round2(totalGross),
        totalDeductions: round2(totalDeductions),
        totalNet,
        warnings: allWarnings,
      },
    }
  } catch (err) {
    await updatePayroll(db, id, { status: 'draft' })
    return {
      success: false as const,
      error: 'processing_error',
      message: err instanceof Error ? err.message : 'Unknown error during processing',
    }
  }
}

export async function closePayrollService(db: AnyDb, id: string) {
  const existing = await getPayroll(db, id)
  if (!existing)
    return { success: false as const, error: 'not_found', message: 'Payroll not found' }
  if (existing.status !== 'processed') {
    return {
      success: false as const,
      error: 'not_processed',
      message: 'Only processed payrolls can be closed',
    }
  }
  const row = await updatePayroll(db, id, { status: 'paid' })
  return { success: true as const, data: row }
}
