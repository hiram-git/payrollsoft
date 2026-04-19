import { countBusinessDays, countCalendarDays, processLine, round2 } from '@payroll/core'
import {
  batchUpsertPayrollLines,
  bulkDeactivateCompletedLoans,
  bulkGetAttendanceSummary,
  bulkGetLoansByEmployees,
  bulkGetPendingInstallments,
  bulkLoadCreditorInstallments,
  bulkMarkInstallmentsPaid,
  bulkReactivateLoansWithPending,
  createPayroll,
  deleteCreatedPayroll,
  deletePayrollAcumulados,
  deletePayrollLines,
  getAllActiveEmployees,
  getAttendanceSummaryForPeriod,
  getCompanyConfig,
  getConceptCatalogs,
  getEmployee,
  getPayroll,
  getPayrollLineById,
  getPayrollLines,
  getPayrollLinesPaged,
  getPosition,
  insertPayrollAcumulados,
  listConceptsWithLinks,
  listCreditors,
  listLoansByEmployee,
  listPayrolls,
  loadAccumulated,
  loadAccumulatedByDateRange,
  loadInstallmentsByCreditor,
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
  filter: { status?: string; type?: string; year?: number } = {},
  page = 1
) {
  return listPayrolls(db, filter, { limit: 25, page })
}

export async function getPayrollService(
  db: AnyDb,
  id: string,
  linesPage = 1,
  linesLimit = 50,
  search?: string
) {
  const [payroll, linesResult] = await Promise.all([
    getPayroll(db, id),
    getPayrollLinesPaged(db, id, { page: linesPage, limit: linesLimit, search }),
  ])
  if (!payroll) return null
  return {
    payroll,
    lines: linesResult.data,
    linesTotal: linesResult.total,
    linesPage: linesResult.page,
    linesLimit: linesResult.limit,
    linesTotalPages: linesResult.totalPages,
  }
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
// 'processing' is included so a payroll stuck by a previous timeout can be retried
const ALLOWED_FOR_REGENERATE = new Set(['generated', 'processed', 'processing'])

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

  // If already stuck at 'processing', roll back to 'generated' on failure
  const originalStatus = payroll.status === 'processing' ? 'generated' : payroll.status

  try {
    // Mark as processing (inside try so we can revert on any failure)
    await updatePayroll(db, id, { status: 'processing' })

    const [allEmployees, allConceptsWithLinks, companyConfig, conceptCatalogs, allCreditors] =
      await Promise.all([
        getAllActiveEmployees(db),
        listConceptsWithLinks(db),
        getCompanyConfig(db),
        getConceptCatalogs(db),
        listCreditors(db, true),
      ])

    const isPublicInstitution = companyConfig?.tipoInstitucion === 'publica'

    const creditorIdsWithConcepts = new Set(
      allCreditors.filter((c) => c.conceptId).map((c) => c.id)
    )

    const freqCodeMap: Record<string, string> = {
      weekly: 'semanal',
      biweekly: 'quincenal',
      monthly: 'mensual',
    }
    const payrollFreqCode = freqCodeMap[payroll.frequency] ?? payroll.frequency
    const payrollFrequencyId = conceptCatalogs.frequencies.find(
      (f) => f.code === payrollFreqCode
    )?.id
    const payrollTypeId = conceptCatalogs.payrollTypes.find((t) => t.code === payroll.type)?.id
    const activoSituationId = conceptCatalogs.situations.find((s) => s.code === 'activo')?.id

    // Build sets of valid catalog IDs so stale link references are ignored
    const validPayrollTypeIds = new Set(conceptCatalogs.payrollTypes.map((t) => t.id))
    const validFrequencyIds = new Set(conceptCatalogs.frequencies.map((f) => f.id))
    const validSituationIds = new Set(conceptCatalogs.situations.map((s) => s.id))

    const activeConcepts = allConceptsWithLinks
      .filter((c) => c.isActive)
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === 'income' ? -1 : 1
        return a.code.localeCompare(b.code)
      })
      .filter((c) => {
        // Filter out stale link IDs (references to catalog items that no longer exist)
        const effectiveTypeIds = c.payrollTypeIds.filter((id) => validPayrollTypeIds.has(id))
        const effectiveFreqIds = c.frequencyIds.filter((id) => validFrequencyIds.has(id))
        const effectiveSitIds = c.situationIds.filter((id) => validSituationIds.has(id))

        if (
          effectiveTypeIds.length > 0 &&
          payrollTypeId &&
          !effectiveTypeIds.includes(payrollTypeId)
        )
          return false
        if (
          effectiveFreqIds.length > 0 &&
          payrollFrequencyId &&
          !effectiveFreqIds.includes(payrollFrequencyId)
        )
          return false
        if (
          effectiveSitIds.length > 0 &&
          activoSituationId &&
          !effectiveSitIds.includes(activoSituationId)
        )
          return false
        return true
      })

    const periodStart = new Date(payroll.periodStart)
    const periodEnd = new Date(payroll.periodEnd)
    const totalDays = countCalendarDays(periodStart, periodEnd)
    const totalBusinessDays = countBusinessDays(periodStart, periodEnd)

    const employeeIds = allEmployees.map((e) => e.id)

    // Bulk-load attendance, loans, and creditor installments — 3 queries instead of N×M
    const [attendanceMap, loansMap, creditorInstallmentsMap] = await Promise.all([
      bulkGetAttendanceSummary(db, employeeIds, payroll.periodStart, payroll.periodEnd),
      bulkGetLoansByEmployees(db, employeeIds),
      bulkLoadCreditorInstallments(db, employeeIds, payroll.periodStart, payroll.periodEnd),
    ])

    // Cache position lookups (public institutions only, usually few distinct positions)
    const positionCache = new Map<string, { salary: string } | null>()

    // Memoize accumulator queries — same concept+employee combo is never queried twice
    const accumCache = new Map<string, number>()
    const memoAccumulated = async (empId: string, code: string, periods: number) => {
      const key = `${empId}:${code}:${periods}`
      if (accumCache.has(key)) return accumCache.get(key) ?? 0
      const val = await loadAccumulated(db, empId, code, periods)
      accumCache.set(key, val)
      return val
    }
    const accumRangeCache = new Map<string, number>()
    const memoAccumulatedByRange = async (
      empId: string,
      code: string,
      from: string,
      to: string
    ) => {
      const key = `${empId}:${code}:${from}:${to}`
      if (accumRangeCache.has(key)) return accumRangeCache.get(key) ?? 0
      const val = await loadAccumulatedByDateRange(db, empId, code, from, to)
      accumRangeCache.set(key, val)
      return val
    }

    let totalGross = 0
    let totalDeductions = 0
    const allWarnings: string[] = []
    const pendingLines: Array<{
      employeeId: string
      grossAmount: string
      deductions: string
      netAmount: string
      concepts: unknown
    }> = []

    for (const emp of allEmployees) {
      // Position salary (public institutions) — cached by positionId
      let effectiveBaseSalary = Number(emp.baseSalary)
      if (isPublicInstitution && emp.positionId) {
        if (!positionCache.has(emp.positionId)) {
          positionCache.set(emp.positionId, await getPosition(db, emp.positionId))
        }
        const pos = positionCache.get(emp.positionId)
        if (pos) effectiveBaseSalary = Number(pos.salary)
      }

      // Attendance from pre-loaded map (O(1))
      const att = attendanceMap.get(emp.id) ?? {
        workedMinutes: 0,
        lateMinutes: 0,
        overtimeMinutes: 0,
        daysWithRecords: 0,
        recordCount: 0,
      }
      const workedDays = att.recordCount > 0 ? att.daysWithRecords : totalBusinessDays
      const absenceDays = Math.max(0, totalBusinessDays - workedDays)

      // Loans from pre-loaded map (O(1))
      const empLoans = loansMap.get(emp.id) ?? []
      const loanInstallments = empLoans
        .filter(
          (l) =>
            l.isActive &&
            l.startDate <= payroll.periodEnd &&
            (l.endDate === null || l.endDate >= payroll.periodStart) &&
            (!l.creditorId || !creditorIdsWithConcepts.has(l.creditorId))
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
          allowZero: c.allowZero,
        })),
        loanInstallments,
        loadAccumulated: (code, periods) => memoAccumulated(emp.id, code, periods),
        loadAccumulatedByDateRange: (code, from, to) =>
          memoAccumulatedByRange(emp.id, code, from, to),
        loadBalance: async () => 0,
        loadInstallmentsByCreditor: (creditorCode) => {
          const byEmp = creditorInstallmentsMap.get(emp.id)
          return Promise.resolve(byEmp?.get(creditorCode) ?? 0)
        },
      })

      if (result.warnings.length > 0) {
        allWarnings.push(...result.warnings.map((w) => `${emp.code}: ${w}`))
      }

      pendingLines.push({
        employeeId: emp.id,
        grossAmount: String(result.grossAmount),
        deductions: String(result.deductions),
        netAmount: String(result.netAmount),
        concepts: result.concepts,
      })

      totalGross += result.grossAmount
      totalDeductions += result.deductions
    }

    // Batch-insert all lines (replaces N individual upserts)
    await batchUpsertPayrollLines(db, id, pendingLines)

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
        processedEmployees: allEmployees.length,
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

  // Idempotent: if already closed (e.g. a previous request completed but the HTTP response was
  // lost), treat as success so the user isn't stuck.
  if (existing.status === 'closed') {
    return { success: true as const, data: existing }
  }

  if (!ALLOWED_FOR_REGENERATE.has(existing.status)) {
    return {
      success: false as const,
      error: 'not_generated',
      message: 'Only generated payrolls can be closed',
    }
  }

  try {
    await updatePayroll(db, id, { status: 'processing' })

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

    // Mark one pending installment as paid per active loan — bulk (3 queries instead of N×M)
    const employeeIds = [...new Set(lines.map((l) => l.line.employeeId))]
    const pendingInstallments = await bulkGetPendingInstallments(
      db,
      employeeIds,
      existing.periodEnd
    )
    const instIds = pendingInstallments.map((i) => i.id)
    const loanIdsToCheck = [...new Set(pendingInstallments.map((i) => i.loanId))]
    await bulkMarkInstallmentsPaid(db, instIds, id)
    await bulkDeactivateCompletedLoans(db, loanIdsToCheck)

    const row = await updatePayroll(db, id, { status: 'closed' })
    return { success: true as const, data: row }
  } catch (err) {
    // Roll back partial changes on failure
    try {
      await deletePayrollAcumulados(db, id)
      await revertPayrollInstallments(db, id)
      const rbLines = await getPayrollLines(db, id)
      const rbEmpIds = [...new Set(rbLines.map((l) => l.line.employeeId))]
      await bulkReactivateLoansWithPending(db, rbEmpIds)
      await updatePayroll(db, id, { status: 'generated' })
    } catch {
      // ignore rollback failure — status may be stuck in 'processing'
    }
    return {
      success: false as const,
      error: 'processing_error',
      message: err instanceof Error ? err.message : 'Error al cerrar la planilla',
    }
  }
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

  // Reactivate loans that now have pending installments — bulk (2 queries instead of N×M)
  const lines = await getPayrollLines(db, id)
  const employeeIds = [...new Set(lines.map((l) => l.line.employeeId))]
  await bulkReactivateLoansWithPending(db, employeeIds)

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
  const row = await updatePayroll(db, id, {
    status: 'created',
    totalGross: '0',
    totalDeductions: '0',
    totalNet: '0',
  })
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

  const [allConceptsWithLinksSingle, companyConfigSingle, catalogsSingle, creditorsSingle] =
    await Promise.all([
      listConceptsWithLinks(db),
      getCompanyConfig(db),
      getConceptCatalogs(db),
      listCreditors(db, true),
    ])

  // Resolve base salary for public institutions
  let effectiveBaseSalaryForRegen = Number(emp.baseSalary)
  if (companyConfigSingle?.tipoInstitucion === 'publica' && emp.positionId) {
    const pos = await getPosition(db, emp.positionId)
    if (pos) effectiveBaseSalaryForRegen = Number(pos.salary)
  }

  const creditorIdsWithConceptsSingle = new Set(
    creditorsSingle.filter((c) => c.conceptId).map((c) => c.id)
  )

  const freqCodeMapSingle: Record<string, string> = {
    weekly: 'semanal',
    biweekly: 'quincenal',
    monthly: 'mensual',
  }
  const payrollFreqCodeSingle = freqCodeMapSingle[payroll.frequency] ?? payroll.frequency
  const payrollFrequencyIdSingle = catalogsSingle.frequencies.find(
    (f) => f.code === payrollFreqCodeSingle
  )?.id
  const payrollTypeIdSingle = catalogsSingle.payrollTypes.find((t) => t.code === payroll.type)?.id
  const activoSituationIdSingle = catalogsSingle.situations.find((s) => s.code === 'activo')?.id

  const validPayrollTypeIdsSingle = new Set(catalogsSingle.payrollTypes.map((t) => t.id))
  const validFrequencyIdsSingle = new Set(catalogsSingle.frequencies.map((f) => f.id))
  const validSituationIdsSingle = new Set(catalogsSingle.situations.map((s) => s.id))

  const activeConcepts = allConceptsWithLinksSingle
    .filter((c) => c.isActive)
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === 'income' ? -1 : 1
      return a.code.localeCompare(b.code)
    })
    .filter((c) => {
      const effectiveTypeIds = c.payrollTypeIds.filter((id) => validPayrollTypeIdsSingle.has(id))
      const effectiveFreqIds = c.frequencyIds.filter((id) => validFrequencyIdsSingle.has(id))
      const effectiveSitIds = c.situationIds.filter((id) => validSituationIdsSingle.has(id))

      if (
        effectiveTypeIds.length > 0 &&
        payrollTypeIdSingle &&
        !effectiveTypeIds.includes(payrollTypeIdSingle)
      )
        return false
      if (
        effectiveFreqIds.length > 0 &&
        payrollFrequencyIdSingle &&
        !effectiveFreqIds.includes(payrollFrequencyIdSingle)
      )
        return false
      if (
        effectiveSitIds.length > 0 &&
        activoSituationIdSingle &&
        !effectiveSitIds.includes(activoSituationIdSingle)
      )
        return false
      return true
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
          (l.endDate === null || l.endDate >= payroll.periodStart) &&
          (!l.creditorId || !creditorIdsWithConceptsSingle.has(l.creditorId))
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
      loadInstallmentsByCreditor: (creditorCode, from, to) =>
        loadInstallmentsByCreditor(db, emp.id, creditorCode, from, to),
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
