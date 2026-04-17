import { countBusinessDays, countCalendarDays, processLine, round2 } from '@payroll/core'
import {
  countPendingInstallments,
  createPayroll,
  deleteCreatedPayroll,
  deletePayrollAcumulados,
  deletePayrollLines,
  getAttendanceSummaryForPeriod,
  getCompanyConfig,
  getEmployee,
  getPayroll,
  getPayrollLineById,
  getPayrollLines,
  getPendingInstallmentsByEmployee,
  getPosition,
  insertPayrollAcumulados,
  listConcepts,
  listEmployees,
  listLoansByEmployee,
  listPayrolls,
  loadAccumulated,
  loadAccumulatedByDateRange,
  loadInstallmentsByCreditor,
  markInstallmentPaid,
  revertPayrollInstallments,
  updateLoan,
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

    const [employeeResult, allConcepts, companyConfig] = await Promise.all([
      listEmployees(db, { isActive: true }, { limit: 1000 }),
      listConcepts(db),
      getCompanyConfig(db),
    ])

    const isPublicInstitution = companyConfig?.tipoInstitucion === 'publica'

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
      // Resolve base salary: public institutions use position salary when available
      let effectiveBaseSalary = Number(emp.baseSalary)
      if (isPublicInstitution && emp.positionId) {
        const pos = await getPosition(db, emp.positionId)
        if (pos) effectiveBaseSalary = Number(pos.salary)
      }

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
          code: emp.code,
          baseSalary: effectiveBaseSalary,
          hireDate: new Date(emp.hireDate),
          customFields: (emp.customFields as Record<string, unknown>) ?? {},
        },
        period: {
          start: periodStart,
          end: periodEnd,
          totalDays,
          type: payroll.frequency as 'biweekly' | 'monthly' | 'weekly',
        },
        payroll: { paymentDate: payroll.paymentDate ?? null },
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
        loadAccumulatedByDateRange: (code, from, to) =>
          loadAccumulatedByDateRange(db, emp.id, code, from, to),
        loadBalance: async () => 0,
        loadInstallmentsByCreditor: (creditorCode, from, to) =>
          loadInstallmentsByCreditor(db, emp.id, creditorCode, from, to),
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

  const lines = await getPayrollLines(db, id)

  // Build acumulados from payroll lines' concepts
  type ConceptEntry = { code: string; name: string; type: string; amount: number }
  const acumuladoItems: Array<{
    payrollId: string
    employeeId: string
    conceptCode: string
    conceptName: string
    conceptType: string
    amount: string
  }> = []

  for (const l of lines) {
    const concepts = ((l.line.concepts ?? []) as ConceptEntry[]).filter((e) => e.amount !== 0)
    for (const entry of concepts) {
      acumuladoItems.push({
        payrollId: id,
        employeeId: l.line.employeeId,
        conceptCode: entry.code,
        conceptName: entry.name,
        conceptType: entry.type,
        amount: String(entry.amount),
      })
    }
  }

  if (acumuladoItems.length > 0) {
    await insertPayrollAcumulados(db, acumuladoItems)
  }

  // Mark one pending installment as paid per active loan per employee
  const employeeIds = [...new Set(lines.map((l) => l.line.employeeId))]
  for (const empId of employeeIds) {
    const pendingInstallments = await getPendingInstallmentsByEmployee(
      db,
      empId,
      existing.periodEnd
    )
    for (const inst of pendingInstallments) {
      await markInstallmentPaid(db, inst.id, id)
      const remaining = await countPendingInstallments(db, inst.loanId)
      if (remaining === 0) {
        await updateLoan(db, inst.loanId, { isActive: false })
      }
    }
  }

  const row = await updatePayroll(db, id, { status: 'closed' })
  return { success: true as const, data: row }
}

/** closed → generated (deletes acumulados so they can be recalculated on re-close) */
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

  await deletePayrollAcumulados(db, id)
  await revertPayrollInstallments(db, id)

  // Reactivate loans that now have pending installments after the revert
  const lines = await getPayrollLines(db, id)
  const employeeIds = [...new Set(lines.map((l) => l.line.employeeId))]
  for (const empId of employeeIds) {
    const empLoans = await listLoansByEmployee(db, empId)
    for (const loan of empLoans) {
      if (!loan.isActive) {
        const pending = await countPendingInstallments(db, loan.id)
        if (pending > 0) {
          await updateLoan(db, loan.id, { isActive: true })
        }
      }
    }
  }

  const row = await updatePayroll(db, id, { status: 'generated' })
  return { success: true as const, data: row }
}

/** generated → created (deletes lines and acumulados so the payroll can be regenerated or deleted) */
export async function revertPayrollService(db: AnyDb, id: string) {
  const existing = await getPayroll(db, id)
  if (!existing)
    return { success: false as const, error: 'not_found', message: 'Payroll not found' }
  if (existing.status !== 'generated') {
    return {
      success: false as const,
      error: 'not_generated',
      message: 'Only generated payrolls can be reverted to created',
    }
  }
  await deletePayrollAcumulados(db, id)
  await deletePayrollLines(db, id)
  const row = await updatePayroll(db, id, { status: 'created' })
  return { success: true as const, data: row }
}

/** generated — reprocess a single employee's line */
export async function regenerateEmployeeService(db: AnyDb, payrollId: string, lineId: string) {
  const payroll = await getPayroll(db, payrollId)
  if (!payroll) return { success: false as const, error: 'not_found', message: 'Payroll not found' }

  if (!ALLOWED_FOR_REGENERATE.has(payroll.status)) {
    return {
      success: false as const,
      error: 'invalid_status',
      message: "La planilla debe estar en estado 'generated' para regenerar",
    }
  }

  const lineData = await getPayrollLineById(db, lineId)
  if (!lineData || lineData.line.payrollId !== payrollId) {
    return { success: false as const, error: 'not_found', message: 'Payroll line not found' }
  }

  const emp = await getEmployee(db, lineData.employee.id)
  if (!emp) return { success: false as const, error: 'not_found', message: 'Employee not found' }

  const [allConcepts, companyConfigSingle] = await Promise.all([
    listConcepts(db),
    getCompanyConfig(db),
  ])

  // Resolve base salary for public institutions
  let effectiveBaseSalaryForRegen = Number(emp.baseSalary)
  if (companyConfigSingle?.tipoInstitucion === 'publica' && emp.positionId) {
    const pos = await getPosition(db, emp.positionId)
    if (pos) effectiveBaseSalaryForRegen = Number(pos.salary)
  }

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

  try {
    const att = await getAttendanceSummaryForPeriod(
      db,
      emp.id,
      payroll.periodStart,
      payroll.periodEnd
    )
    const workedDays = att.recordCount > 0 ? att.daysWithRecords : totalBusinessDays
    const absenceDays = Math.max(0, totalBusinessDays - workedDays)

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
        code: emp.code,
        baseSalary: effectiveBaseSalaryForRegen,
        hireDate: new Date(emp.hireDate),
        customFields: (emp.customFields as Record<string, unknown>) ?? {},
      },
      period: {
        start: periodStart,
        end: periodEnd,
        totalDays,
        type: payroll.frequency as 'biweekly' | 'monthly' | 'weekly',
      },
      payroll: { paymentDate: payroll.paymentDate ?? null },
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
      loadAccumulatedByDateRange: (code, from, to) =>
        loadAccumulatedByDateRange(db, emp.id, code, from, to),
      loadBalance: async () => 0,
    })

    await upsertPayrollLine(db, {
      payrollId,
      employeeId: emp.id,
      grossAmount: String(result.grossAmount),
      deductions: String(result.deductions),
      netAmount: String(result.netAmount),
      concepts: result.concepts,
    })

    // Recalculate payroll totals from all remaining lines
    const allLines = await getPayrollLines(db, payrollId)
    let totalGross = 0
    let totalDeductions = 0
    for (const l of allLines) {
      totalGross += Number(l.line.grossAmount)
      totalDeductions += Number(l.line.deductions)
    }
    const totalNet = round2(totalGross - totalDeductions)
    await updatePayroll(db, payrollId, {
      totalGross: String(round2(totalGross)),
      totalDeductions: String(round2(totalDeductions)),
      totalNet: String(totalNet),
    })

    return { success: true as const, data: result }
  } catch (err) {
    return {
      success: false as const,
      error: 'processing_error',
      message: err instanceof Error ? err.message : 'Unknown error during regeneration',
    }
  }
}

// ─── Legacy aliases ───────────────────────────────────────────────────────────

/** @deprecated use generatePayrollService */
export const processPayrollService = generatePayrollService
