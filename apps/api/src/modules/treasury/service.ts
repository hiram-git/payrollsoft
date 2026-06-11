import { type AchEntry, amountToWords, generateAchMupaText } from '@payroll/core/treasury'
/**
 * Service layer del módulo de tesorería.
 *
 * Operaciones soportadas:
 *   • Catálogo de bancos (CRUD).
 *   • Catálogo de chequeras (CRUD + asignación de número siguiente).
 *   • Corridas de pago (`payment_runs`) — agrupan ACH + cheques de
 *     una planilla.
 *   • Emitir cheques (avanza next_number de la chequera; deja la
 *     amount_in_words renderizada).
 *   • Generar lote ACH (snapshot del TXT a `treasury_ach_batches`).
 *   • Anular cheques (libera el número en disputa; queda en histórico).
 */
import {
  banks,
  creditors,
  employees,
  payrollLines,
  payrolls,
  treasuryAchBatches,
  treasuryAchLines,
  treasuryCheckbooks,
  treasuryChecks,
  treasuryPaymentRuns,
} from '@payroll/db'
import { and, desc, eq, sql } from 'drizzle-orm'

// biome-ignore lint/suspicious/noExplicitAny: drizzle generic
type AnyDb = any

// ─── Bancos ───────────────────────────────────────────────────────────────

export async function listBanks(db: AnyDb) {
  return db.select().from(banks).orderBy(banks.sortOrder, banks.name)
}

export async function createBank(
  db: AnyDb,
  input: {
    code: string
    name: string
    routing?: string | null
    swift?: string | null
    achFormat?: string | null
    achEntityCode?: string | null
  }
) {
  const [row] = await db
    .insert(banks)
    .values({
      code: input.code,
      name: input.name,
      routing: input.routing ?? null,
      swift: input.swift ?? null,
      achFormat: input.achFormat ?? null,
      achEntityCode: input.achEntityCode ?? null,
    })
    .returning()
  return row
}

export async function updateBank(
  db: AnyDb,
  id: string,
  patch: {
    name?: string
    routing?: string | null
    swift?: string | null
    achFormat?: string | null
    achEntityCode?: string | null
    isActive?: number
    sortOrder?: number
  }
) {
  const res = await db.update(banks).set(patch).where(eq(banks.id, id)).returning()
  return res[0] ?? null
}

// ─── Chequeras ────────────────────────────────────────────────────────────

export async function listCheckbooks(db: AnyDb) {
  return db.select().from(treasuryCheckbooks).orderBy(treasuryCheckbooks.name)
}

export async function getCheckbook(db: AnyDb, id: string) {
  const [row] = await db
    .select()
    .from(treasuryCheckbooks)
    .where(eq(treasuryCheckbooks.id, id))
    .limit(1)
  return row ?? null
}

export async function createCheckbook(
  db: AnyDb,
  input: {
    code: string
    name: string
    bankId?: string | null
    accountNumber: string
    startNumber: number
    endNumber: number
    purpose: 'employees' | 'creditors' | 'general'
  }
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (input.startNumber > input.endNumber) {
    return { ok: false, error: 'El número inicial debe ser ≤ al final.' }
  }
  const [row] = await db
    .insert(treasuryCheckbooks)
    .values({
      code: input.code,
      name: input.name,
      bankId: input.bankId ?? null,
      accountNumber: input.accountNumber,
      startNumber: input.startNumber,
      endNumber: input.endNumber,
      nextNumber: input.startNumber,
      purpose: input.purpose,
    })
    .returning({ id: treasuryCheckbooks.id })
  return { ok: true, id: row.id as string }
}

// ─── Payment runs ─────────────────────────────────────────────────────────

export async function listPaymentRuns(db: AnyDb) {
  return db.select().from(treasuryPaymentRuns).orderBy(desc(treasuryPaymentRuns.createdAt))
}

export async function createPaymentRun(
  db: AnyDb,
  input: { payrollId?: string | null; name: string; notes?: string | null },
  options: { createdBy?: string | null } = {}
): Promise<{ success: true; id: string } | { success: false; error: string }> {
  if (input.payrollId) {
    const [payroll] = await db
      .select({ status: payrolls.status })
      .from(payrolls)
      .where(eq(payrolls.id, input.payrollId))
      .limit(1)
    if (!payroll) return { success: false, error: 'Planilla no encontrada.' }
    if (payroll.status !== 'closed') {
      return { success: false, error: 'La planilla debe estar cerrada para generar cheques.' }
    }
  }
  const [row] = await db
    .insert(treasuryPaymentRuns)
    .values({
      payrollId: input.payrollId ?? null,
      name: input.name,
      notes: input.notes ?? null,
      createdBy: options.createdBy ?? null,
      status: 'open',
    })
    .returning({ id: treasuryPaymentRuns.id })
  return { success: true, id: row.id as string }
}

export async function closePaymentRun(db: AnyDb, id: string) {
  await db
    .update(treasuryPaymentRuns)
    .set({ status: 'closed', closedAt: new Date() })
    .where(eq(treasuryPaymentRuns.id, id))
  return true
}

// ─── Carga de líneas pagables desde una planilla ──────────────────────────

export type Payable = {
  beneficiaryType: 'employee' | 'creditor'
  beneficiaryId: string
  beneficiaryName: string
  identification: string | null
  amount: number
  paymentMethod: 'ach' | 'check' | 'cash'
  bankId: string | null
  bankRouting: string | null
  accountNumber: string | null
  accountType: 'savings' | 'checking' | null
}

/**
 * Carga las líneas pagables de una planilla cerrada. Para cada
 * `payroll_lines.netAmount` produce un Payable etiquetado por el
 * `payment_method` del empleado. Solo retorna empleados — los
 * acreedores se cargan por separado con `getCreditorPayables` porque
 * vienen de las deducciones agregadas, no de payroll_lines.
 */
export async function getEmployeePayables(db: AnyDb, payrollId: string): Promise<Payable[]> {
  const rows = await db
    .select({
      employeeId: payrollLines.employeeId,
      netAmount: payrollLines.netAmount,
      code: employees.code,
      firstName: employees.firstName,
      lastName: employees.lastName,
      idNumber: employees.idNumber,
      bankId: employees.bankId,
      accountNumber: employees.accountNumber,
      accountType: employees.accountType,
      paymentMethod: employees.paymentMethod,
      bankRouting: banks.routing,
    })
    .from(payrollLines)
    .innerJoin(employees, eq(employees.id, payrollLines.employeeId))
    .leftJoin(banks, eq(banks.id, employees.bankId))
    .where(eq(payrollLines.payrollId, payrollId))

  return (rows as Array<Record<string, unknown>>).map((r) => ({
    beneficiaryType: 'employee' as const,
    beneficiaryId: String(r.employeeId),
    beneficiaryName: `${r.lastName} ${r.firstName}`.trim(),
    identification: r.idNumber ? String(r.idNumber) : null,
    amount: Number(r.netAmount ?? 0),
    paymentMethod: (r.paymentMethod ?? 'check') as 'ach' | 'check' | 'cash',
    bankId: r.bankId ? String(r.bankId) : null,
    bankRouting: r.bankRouting ? String(r.bankRouting) : null,
    accountNumber: r.accountNumber ? String(r.accountNumber) : null,
    accountType: (r.accountType ?? null) as 'savings' | 'checking' | null,
  }))
}

// ─── Emitir cheque ────────────────────────────────────────────────────────

export type IssueCheckInput = {
  checkbookId: string
  paymentRunId?: string | null
  beneficiaryType: 'employee' | 'creditor' | 'other'
  beneficiaryRefId?: string | null
  beneficiaryName: string
  amount: number | string
  concept?: string | null
  issueDate: string
}

export async function issueCheck(
  db: AnyDb,
  input: IssueCheckInput,
  options: { createdBy?: string | null } = {}
): Promise<
  | { success: true; data: { id: string; checkNumber: number; amountInWords: string } }
  | { success: false; error: string }
> {
  // biome-ignore lint/suspicious/noExplicitAny: drizzle tx
  return db.transaction(async (tx: any) => {
    // Advisory lock por chequera para serializar la asignación de número
    // bajo concurrencia (dos cajeros emitiendo cheques a la vez).
    await tx.execute(sql`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${`chk:${input.checkbookId}`}, 0)
      )
    `)
    const [book] = await tx
      .select()
      .from(treasuryCheckbooks)
      .where(eq(treasuryCheckbooks.id, input.checkbookId))
      .limit(1)
    if (!book) return { success: false as const, error: 'Chequera no encontrada.' }
    if (book.isActive !== 1) {
      return { success: false as const, error: 'La chequera está inactiva.' }
    }
    if (book.nextNumber > book.endNumber) {
      return {
        success: false as const,
        error: 'La chequera está agotada — registra una nueva.',
      }
    }

    const checkNumber = book.nextNumber
    const amountStr = typeof input.amount === 'number' ? input.amount.toFixed(2) : input.amount
    const amountInWords = amountToWords(amountStr)

    const [row] = await tx
      .insert(treasuryChecks)
      .values({
        checkbookId: input.checkbookId,
        checkNumber,
        paymentRunId: input.paymentRunId ?? null,
        beneficiaryType: input.beneficiaryType,
        beneficiaryRefId: input.beneficiaryRefId ?? null,
        beneficiaryName: input.beneficiaryName,
        amount: amountStr,
        amountInWords,
        concept: input.concept ?? null,
        issueDate: input.issueDate,
        status: 'issued',
        createdBy: options.createdBy ?? null,
      })
      .returning({ id: treasuryChecks.id })

    await tx
      .update(treasuryCheckbooks)
      .set({ nextNumber: checkNumber + 1, updatedAt: new Date() })
      .where(eq(treasuryCheckbooks.id, input.checkbookId))

    return {
      success: true as const,
      data: { id: row.id as string, checkNumber, amountInWords },
    }
  })
}

export async function voidCheck(
  db: AnyDb,
  checkId: string,
  reason: string,
  performedBy: string
): Promise<{ success: true } | { success: false; error: string }> {
  const [existing] = await db
    .select()
    .from(treasuryChecks)
    .where(eq(treasuryChecks.id, checkId))
    .limit(1)
  if (!existing) return { success: false, error: 'Cheque no encontrado.' }
  if (existing.status === 'voided') {
    return { success: false, error: 'El cheque ya está anulado.' }
  }
  if (existing.status === 'cleared') {
    return { success: false, error: 'No se puede anular un cheque ya cobrado.' }
  }
  await db
    .update(treasuryChecks)
    .set({
      status: 'voided',
      voidedAt: new Date(),
      voidReason: reason.trim() || 'Sin razón especificada.',
    })
    .where(eq(treasuryChecks.id, checkId))
  void performedBy
  return { success: true }
}

/**
 * Trae un cheque individual con datos enriquecidos de la chequera
 * y el banco — útil para los renderers de PDF/Excel que necesitan
 * `bankName` y `accountNumber` para la cabecera.
 */
export async function getCheckWithChequera(db: AnyDb, checkId: string) {
  const rows = await db
    .select({
      check: treasuryChecks,
      checkbook: treasuryCheckbooks,
      bankName: banks.name,
    })
    .from(treasuryChecks)
    .leftJoin(treasuryCheckbooks, eq(treasuryCheckbooks.id, treasuryChecks.checkbookId))
    .leftJoin(banks, eq(banks.id, treasuryCheckbooks.bankId))
    .where(eq(treasuryChecks.id, checkId))
    .limit(1)
  return rows[0] ?? null
}

export async function listChecksByRun(db: AnyDb, paymentRunId: string) {
  return db
    .select()
    .from(treasuryChecks)
    .where(eq(treasuryChecks.paymentRunId, paymentRunId))
    .orderBy(treasuryChecks.checkNumber)
}

/**
 * Listado global de cheques (todas las corridas) enriquecido con el nombre de
 * la chequera, el banco y la corrida — para la vista consolidada de Tesorería.
 */
export async function listAllChecks(db: AnyDb) {
  return db
    .select({
      id: treasuryChecks.id,
      checkNumber: treasuryChecks.checkNumber,
      beneficiaryName: treasuryChecks.beneficiaryName,
      amount: treasuryChecks.amount,
      status: treasuryChecks.status,
      issueDate: treasuryChecks.issueDate,
      concept: treasuryChecks.concept,
      paymentRunId: treasuryChecks.paymentRunId,
      checkbookName: treasuryCheckbooks.name,
      bankName: banks.name,
      runName: treasuryPaymentRuns.name,
    })
    .from(treasuryChecks)
    .leftJoin(treasuryCheckbooks, eq(treasuryCheckbooks.id, treasuryChecks.checkbookId))
    .leftJoin(banks, eq(banks.id, treasuryCheckbooks.bankId))
    .leftJoin(treasuryPaymentRuns, eq(treasuryPaymentRuns.id, treasuryChecks.paymentRunId))
    .orderBy(desc(treasuryChecks.issueDate), desc(treasuryChecks.checkNumber))
}

export async function markCheckPrinted(db: AnyDb, checkId: string) {
  await db
    .update(treasuryChecks)
    .set({ status: 'printed', printedAt: new Date() })
    .where(and(eq(treasuryChecks.id, checkId), eq(treasuryChecks.status, 'issued')))
}

// ─── Generación de batch ACH ─────────────────────────────────────────────

export type GenerateAchInput = {
  paymentRunId: string
  payrollId: string
  sourceBankId?: string | null
  /** 'first' | 'second' | 'monthly' o etiqueta libre */
  frequency: string
  /** 1..12 */
  month: number
  year: number
  /** Fecha de pago YYYY-MM-DD que va en cada línea L */
  paymentDate: string
  /** Si true, solo incluye empleados con paymentMethod='ach' */
  achOnly?: boolean
}

export async function generateAchBatch(
  db: AnyDb,
  input: GenerateAchInput,
  options: { generatedBy?: string | null } = {}
): Promise<
  | {
      success: true
      data: {
        batchId: string
        fileName: string
        recordCount: number
        totalAmount: number
        content: string
      }
    }
  | { success: false; error: string }
> {
  const payables = await getEmployeePayables(db, input.payrollId)
  const eligible = payables.filter(
    (p) => p.paymentMethod === 'ach' && p.accountNumber && p.accountType && p.bankRouting
  )

  if (eligible.length === 0) {
    return {
      success: false,
      error: 'No hay empleados elegibles para ACH (con cuenta + ruta bancaria configuradas).',
    }
  }

  const entries: AchEntry[] = eligible.map((p) => ({
    identification: p.identification ?? '',
    beneficiaryName: p.beneficiaryName,
    amount: p.amount,
    paymentDate: input.paymentDate,
    routing: p.bankRouting ?? '',
    accountNumber: p.accountNumber ?? '',
    accountType: p.accountType ?? 'checking',
  }))

  const result = generateAchMupaText(entries, {
    frequency: input.frequency,
    month: input.month,
    year: input.year,
  })

  const fileName = `ACH_${input.year}${String(input.month).padStart(2, '0')}_${Date.now()}.txt`

  // biome-ignore lint/suspicious/noExplicitAny: drizzle tx
  return db.transaction(async (tx: any) => {
    const [batch] = await tx
      .insert(treasuryAchBatches)
      .values({
        paymentRunId: input.paymentRunId,
        sourceBankId: input.sourceBankId ?? null,
        format: 'mupa_v1',
        fileName,
        fileContent: result.content,
        recordCount: result.recordCount,
        totalAmount: result.totalAmount.toFixed(2),
        generatedBy: options.generatedBy ?? null,
      })
      .returning({ id: treasuryAchBatches.id })

    const lines = eligible.map((p) => ({
      batchId: batch.id,
      employeeId: p.beneficiaryId,
      beneficiaryName: p.beneficiaryName,
      identification: p.identification,
      bankRouting: p.bankRouting,
      accountNumber: p.accountNumber,
      accountType: p.accountType,
      amount: p.amount.toFixed(2),
    }))
    if (lines.length > 0) await tx.insert(treasuryAchLines).values(lines)

    return {
      success: true as const,
      data: {
        batchId: batch.id as string,
        fileName,
        recordCount: result.recordCount,
        totalAmount: result.totalAmount,
        content: result.content,
      },
    }
  })
}

export async function getAchBatch(db: AnyDb, batchId: string) {
  const [batch] = await db
    .select()
    .from(treasuryAchBatches)
    .where(eq(treasuryAchBatches.id, batchId))
    .limit(1)
  return batch ?? null
}

/**
 * Listado global de lotes ACH / archivos generados (todas las corridas),
 * sin el contenido del archivo (que puede ser grande) — para la vista
 * consolidada de Tesorería. Cada fila es descargable por su `id`.
 */
export async function listAllAchBatches(db: AnyDb) {
  return db
    .select({
      id: treasuryAchBatches.id,
      format: treasuryAchBatches.format,
      fileName: treasuryAchBatches.fileName,
      totalAmount: treasuryAchBatches.totalAmount,
      recordCount: treasuryAchBatches.recordCount,
      generatedAt: treasuryAchBatches.generatedAt,
      paymentRunId: treasuryAchBatches.paymentRunId,
      sourceBankName: banks.name,
      runName: treasuryPaymentRuns.name,
    })
    .from(treasuryAchBatches)
    .leftJoin(banks, eq(banks.id, treasuryAchBatches.sourceBankId))
    .leftJoin(treasuryPaymentRuns, eq(treasuryPaymentRuns.id, treasuryAchBatches.paymentRunId))
    .orderBy(desc(treasuryAchBatches.generatedAt))
}

void payrolls
void creditors
