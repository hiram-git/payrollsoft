import { countBusinessDays, countCalendarDays, processLine, round2 } from '@payroll/core'
import {
  createPayroll,
  deleteCreatedPayroll,
  deletePayrollAcumulados,
  getAttendanceSummaryForPeriod,
  getPayroll,
  getPayrollLines,
  insertPayrollAcumulados,
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
    status: 'created',
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
  if (existing.status !== 'created') {
    return {
      success: false as const,
      error: 'not_editable',
      message: 'Only created payrolls can be edited',
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
  if (existing.status !== 'created') {
    return {
      success: false as const,
      error: 'not_deletable',
      message: 'Only created payrolls can be deleted',
    }
  }
  await deleteCreatedPayroll(db, id)
  return { success: true as const }
}

// ─── Payroll Generation (shared logic) ───────────────────────────────────────

// Accept both new and legacy status names for backward compatibility
const ALLOWED_FOR_GENERATE = new Set(['created', 'draft'])
const ALLOWED_FOR_REGENERATE = new Set(['generated', 'processed'])

async function runGeneration(db: AnyDb, id: string, phase: 'generate' | 'regenerate') {
  const payroll = await getPayroll(db, id)
  if (!payroll) return { success: false as const, error: 'not_found', message: 'Payroll not found' }

  const allowed = phase === 'generate' ? ALLOWED_FOR_GENERATE : ALLOWED_FOR_REGENERATE
  if (!allowed.has(payroll.status)) {
    const expected = phase === 'generate' ? 'created' : 'generated'
    return {
      success: false as const,
      error: 'invalid_status',
      message: `La planilla debe estar en estado '${expected}' para ${phase === 'generate' ? 'generar' : 'regenerar'}`,
    }
  }

  const originalStatus = payroll.status

  try {
    // Mark as processing (inside try so we can revert on any failure)
    await updatePayroll(db, id, { status: 'processing' })

    // Wipe previous results before (re)computing
    await deletePayrollAcumulados(db, id)

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
    const acumuladoItems: {
      payrollId: string
      employeeId: string
      conceptCode: string
      conceptName: string
      conceptType: string
      amount: string
    }[] = []

    for (const emp of employeeResult.data) {
      // Attendance for the period
      const att = await getAttendanceSummaryForPeriod(
        db,
        emp.id,
        payroll.periodStart,
        payroll.periodEnd
      )

      const workedDays = att.recordCount > 0 ? att.daysWithRecords : totalBusinessDays
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
        loadBalance: async () => 0,
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

      // Collect acumulado rows (one per concept entry per employee)
      for (const entry of result.concepts) {
        if (entry.amount !== 0) {
          acumuladoItems.push({
            payrollId: id,
            employeeId: emp.id,
            conceptCode: entry.code,
            conceptName: entry.name,
            conceptType: entry.type,
            amount: String(entry.amount),
          })
        }
      }

      totalGross += result.grossAmount
      totalDeductions += result.deductions
    }

    // Persist acumulados
    await insertPayrollAcumulados(db, acumuladoItems)

    const totalNet = round2(totalGross - totalDeductions)
    await updatePayroll(db, id, {
      status: 'generated',
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
    // Revert to original status on any failure
    try {
      await updatePayroll(db, id, { status: originalStatus })
    } catch {
      // ignore revert failure
    }
    return {
      success: false as const,
      error: 'processing_error',
      message: err instanceof Error ? err.message : 'Unknown error during processing',
    }
  }
}

// ─── State Transitions ────────────────────────────────────────────────────────

/** created → generated */
export function generatePayrollService(db: AnyDb, id: string) {
  return runGeneration(db, id, 'generate')
}

/** generated → generated (reprocess) */
export function regeneratePayrollService(db: AnyDb, id: string) {
  return runGeneration(db, id, 'regenerate')
}

/** generated → closed */
export async function closePayrollService(db: AnyDb, id: string) {
  const existing = await getPayroll(db, id)
  if (!existing)
    return { success: false as const, error: 'not_found', message: 'Payroll not found' }
  if (!ALLOWED_FOR_REGENERATE.has(existing.status)) {
    return {
      success: false as const,
      error: 'not_generated',
      message: 'Only generated payrolls can be closed',
    }
  }
  const row = await updatePayroll(db, id, { status: 'closed' })
  return { success: true as const, data: row }
}

/** closed → generated */
export async function reopenPayrollService(db: AnyDb, id: string) {
  const existing = await getPayroll(db, id)
  if (!existing)
    return { success: false as const, error: 'not_found', message: 'Payroll not found' }
  if (existing.status !== 'closed') {
    return {
      success: false as const,
      error: 'not_closed',
      message: 'Only closed payrolls can be reopened',
    }
  }
  const row = await updatePayroll(db, id, { status: 'generated' })
  return { success: true as const, data: row }
}

// ─── Legacy aliases ───────────────────────────────────────────────────────────

/** @deprecated use generatePayrollService */
export const processPayrollService = generatePayrollService
