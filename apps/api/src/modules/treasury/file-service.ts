/**
 * Generación de archivos de banco / contraloría a partir de una planilla
 * cerrada (o, para el bloqueo mensual, del presupuesto de las posiciones).
 *
 * Cada función reúne los datos del schema, delega el formateo de ancho fijo a
 * los generadores puros de `@payroll/core/treasury` y persiste un snapshot en
 * `treasury_ach_batches` para que la descarga sea reproducible.
 */
import {
  type BancoGeneralEntry,
  type BancoNacionalEntry,
  type BloqueoMensualEntry,
  type BloqueoQuincenalPartida,
  generateBancoGeneralText,
  generateBancoNacionalText,
  generateBloqueoMensualText,
  generateBloqueoQuincenalText,
  monthNameEs,
} from '@payroll/core/treasury'
import {
  banks,
  budgetItems,
  companyConfig,
  employees,
  payrollLines,
  payrolls,
  positions,
  treasuryAchBatches,
  treasuryAchLines,
} from '@payroll/db'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { getClosedPayrollIdsForMonth, getCreditorPayables } from './service'

// biome-ignore lint/suspicious/noExplicitAny: drizzle generic
type AnyDb = any

/** A quién se le genera el ACH: empleados de una planilla, o acreedores de un mes. */
export type AchScope =
  | { beneficiary: 'employees'; payrollId: string }
  | { beneficiary: 'creditors'; month: number; year: number }

type AchRow = {
  identification: string
  name: string
  amount: number
  accountNumber: string | null
  accountType: 'savings' | 'checking' | null
  bankId: string | null
  routing: string | null
  entityCode: string | null
  refType: 'employee' | 'creditor'
  refId: string
}

export type TreasuryFileFormat =
  | 'banco_nacional'
  | 'banco_general'
  | 'bloqueo_quincenal'
  | 'bloqueo_mensual'

type GenerateOk = {
  success: true
  data: {
    batchId: string
    fileName: string
    format: TreasuryFileFormat
    recordCount: number
    totalAmount: number
    content: string
  }
}
type GenerateErr = { success: false; error: string }
type GenerateResult = GenerateOk | GenerateErr

function dmy(isoDate: string | null): string {
  if (!isoDate) return ''
  const [y, m, d] = isoDate.split('-')
  return `${d}/${m}/${y}`
}

function halfFromPaymentDate(paymentDate: string | null): 1 | 2 {
  if (!paymentDate) return 1
  const day = Number(paymentDate.slice(8, 10))
  return day >= 1 && day <= 15 ? 1 : 2
}

function deriveDescription(
  payroll: { type: string; periodStart: string; periodEnd: string },
  half: 1 | 2
): string {
  const label = payroll.type === 'regular' ? 'REGULAR' : payroll.type.toUpperCase()
  const quincena = half === 1 ? '1ra' : '2da'
  return `${label}-${quincena} Quincena - DEL ${dmy(payroll.periodStart)} - Al ${dmy(payroll.periodEnd)}`
}

async function getPayroll(db: AnyDb, payrollId: string) {
  const [row] = await db
    .select({
      id: payrolls.id,
      type: payrolls.type,
      status: payrolls.status,
      periodStart: payrolls.periodStart,
      periodEnd: payrolls.periodEnd,
      paymentDate: payrolls.paymentDate,
    })
    .from(payrolls)
    .where(eq(payrolls.id, payrollId))
    .limit(1)
  return row ?? null
}

async function getCompanyName(db: AnyDb): Promise<string> {
  const [row] = await db.select({ name: companyConfig.companyName }).from(companyConfig).limit(1)
  return (row?.name as string | null) ?? ''
}

async function getCompanyEntity(
  db: AnyDb
): Promise<{ entityName: string; entityCode: string; patronalNumber: string }> {
  const [row] = await db
    .select({
      name: companyConfig.companyName,
      entityName: companyConfig.entityName,
      entityCode: companyConfig.entityCode,
      patronal: companyConfig.patronalNumber,
    })
    .from(companyConfig)
    .limit(1)
  return {
    entityName: (row?.entityName as string | null) ?? (row?.name as string | null) ?? '',
    entityCode: (row?.entityCode as string | null) ?? '',
    patronalNumber: (row?.patronal as string | null) ?? '',
  }
}

export type ContraloriaReport =
  | { ok: true; fileName: string; content: string }
  | { ok: false; error: string }

/**
 * Bloqueo presupuestario por planilla, agregado por mes + año (+ tipo de
 * planilla opcional): suma lo pagado por partida a través de TODAS las
 * planillas cerradas del período. Replica el layout legacy.
 */
export async function buildBloqueoPlanillaReport(
  db: AnyDb,
  input: { month: number; year: number; payrollTypeId?: string | null }
): Promise<ContraloriaReport> {
  const conds = [
    eq(payrolls.status, 'closed'),
    sql`EXTRACT(YEAR FROM ${payrolls.paymentDate}) = ${input.year}`,
    sql`EXTRACT(MONTH FROM ${payrolls.paymentDate}) = ${input.month}`,
  ]
  if (input.payrollTypeId) conds.push(eq(payrolls.payrollTypeId, input.payrollTypeId))
  const idRows = await db
    .select({ id: payrolls.id })
    .from(payrolls)
    .where(and(...conds))
  const ids = (idRows as Array<{ id: string }>).map((r) => r.id)
  if (ids.length === 0) {
    return { ok: false, error: 'No hay planillas cerradas para el mes y tipo seleccionados.' }
  }

  const rows = await db
    .select({
      partida: budgetItems.code,
      total: sql<string>`SUM(CAST(${payrollLines.grossAmount} AS NUMERIC))`,
    })
    .from(payrollLines)
    .innerJoin(employees, eq(employees.id, payrollLines.employeeId))
    .innerJoin(positions, eq(positions.id, employees.positionId))
    .innerJoin(budgetItems, eq(budgetItems.id, positions.budgetItemId))
    .where(inArray(payrollLines.payrollId, ids))
    .groupBy(budgetItems.code)
    .orderBy(asc(budgetItems.code))

  const partidas = (rows as Array<{ partida: string; total: string }>).map((r) => ({
    partida: r.partida,
    total: Number(r.total ?? 0),
  }))
  if (partidas.length === 0) {
    return { ok: false, error: 'No hay partidas asociadas a las posiciones de las planillas del mes.' }
  }

  const entity = await getCompanyEntity(db)
  const result = generateBloqueoQuincenalText(partidas, {
    entityName: entity.entityName,
    ministerioCode: entity.entityCode || (partidas[0]?.partida.slice(0, 3) ?? ''),
    paymentDateLabel: `${String(input.month).padStart(2, '0')}/${input.year}`,
    month: input.month,
    year: input.year,
    half: 1,
    periodLabel: 'MENSUAL',
  })
  return {
    ok: true,
    fileName: `Bloqueo_planilla_${monthNameEs(input.month)}_${input.year}.txt`,
    content: result.content,
  }
}

/** Bloqueo presupuestario mensual desde el presupuesto de las posiciones. */
export async function buildBloqueoMensualReport(
  db: AnyDb,
  input: { month: number; year: number }
): Promise<ContraloriaReport> {
  const base = await db
    .select({
      partida: budgetItems.code,
      total: sql<string>`SUM(CAST(${positions.salary} AS NUMERIC))`,
    })
    .from(positions)
    .innerJoin(budgetItems, eq(budgetItems.id, positions.budgetItemId))
    .groupBy(budgetItems.code)
    .orderBy(asc(budgetItems.code))
  const representation = await db
    .select({
      partida: budgetItems.code,
      total: sql<string>`SUM(CAST(${positions.representationAmount} AS NUMERIC))`,
    })
    .from(positions)
    .innerJoin(budgetItems, eq(budgetItems.id, positions.representationBudgetItemId))
    .where(sql`CAST(${positions.representationAmount} AS NUMERIC) > 0`)
    .groupBy(budgetItems.code)
    .orderBy(asc(budgetItems.code))
  const entries = [...base, ...representation].map((r: { partida: string; total: string }) => ({
    partida: r.partida,
    total: Number(r.total ?? 0),
  }))
  if (entries.length === 0) {
    return { ok: false, error: 'No hay posiciones con partida presupuestaria configurada.' }
  }
  const result = generateBloqueoMensualText(entries, { month: input.month, year: input.year })
  return {
    ok: true,
    fileName: `Bloqueo_mensual_${monthNameEs(input.month)}_${input.year}.txt`,
    content: result.content,
  }
}

async function storeBatch(
  db: AnyDb,
  input: {
    paymentRunId?: string | null
    sourceBankId?: string | null
    format: TreasuryFileFormat
    fileName: string
    content: string
    recordCount: number
    totalAmount: number
  },
  options: { generatedBy?: string | null },
  lines?: Array<Record<string, unknown>>
): Promise<string> {
  // biome-ignore lint/suspicious/noExplicitAny: drizzle tx
  return db.transaction(async (tx: any) => {
    const [batch] = await tx
      .insert(treasuryAchBatches)
      .values({
        paymentRunId: input.paymentRunId ?? null,
        sourceBankId: input.sourceBankId ?? null,
        format: input.format,
        fileName: input.fileName,
        fileContent: input.content,
        recordCount: input.recordCount,
        totalAmount: input.totalAmount.toFixed(2),
        generatedBy: options.generatedBy ?? null,
      })
      .returning({ id: treasuryAchBatches.id })
    if (lines && lines.length > 0) {
      await tx.insert(treasuryAchLines).values(lines.map((l) => ({ ...l, batchId: batch.id })))
    }
    return batch.id as string
  })
}

// ─── Recolección de beneficiarios ACH (empleados o acreedores) ──────────────

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

async function scopeMeta(
  db: AnyDb,
  scope: AchScope
): Promise<
  | { ok: true; description: string; month: number; year: number; dateCompact: string }
  | { ok: false; error: string }
> {
  if (scope.beneficiary === 'employees') {
    const payroll = await getPayroll(db, scope.payrollId)
    if (!payroll) return { ok: false, error: 'Planilla no encontrada.' }
    if (payroll.status !== 'closed') {
      return { ok: false, error: 'La planilla debe estar cerrada para generar el archivo.' }
    }
    const half = halfFromPaymentDate(payroll.paymentDate)
    const dateSrc = (payroll.paymentDate ?? payroll.periodEnd) as string
    return {
      ok: true,
      description: deriveDescription(payroll, half),
      month: Number(dateSrc.slice(5, 7)),
      year: Number(dateSrc.slice(0, 4)),
      dateCompact: dateSrc.slice(0, 10).replace(/-/g, ''),
    }
  }
  return {
    ok: true,
    description: `PAGO A ACREEDORES ${monthNameEs(scope.month)} ${scope.year}`,
    month: scope.month,
    year: scope.year,
    dateCompact: `${scope.year}${pad2(scope.month)}`,
  }
}

async function gatherAchRows(db: AnyDb, scope: AchScope): Promise<AchRow[]> {
  if (scope.beneficiary === 'employees') {
    const rows = await db
      .select({
        refId: employees.id,
        idNumber: employees.idNumber,
        firstName: employees.firstName,
        lastName: employees.lastName,
        netAmount: payrollLines.netAmount,
        accountNumber: employees.accountNumber,
        accountType: employees.accountType,
        bankId: employees.bankId,
        routing: banks.routing,
        entityCode: banks.achEntityCode,
      })
      .from(payrollLines)
      .innerJoin(employees, eq(employees.id, payrollLines.employeeId))
      .leftJoin(banks, eq(banks.id, employees.bankId))
      .where(and(eq(payrollLines.payrollId, scope.payrollId), eq(employees.paymentMethod, 'ach')))
      .orderBy(asc(employees.idNumber))
    return (rows as Array<Record<string, unknown>>).map((r) => ({
      identification: String(r.idNumber ?? ''),
      name: `${r.firstName} ${r.lastName}`.trim(),
      amount: Number(r.netAmount ?? 0),
      accountNumber: r.accountNumber ? String(r.accountNumber) : null,
      accountType: (r.accountType ?? null) as 'savings' | 'checking' | null,
      bankId: r.bankId ? String(r.bankId) : null,
      routing: r.routing ? String(r.routing) : null,
      entityCode: r.entityCode ? String(r.entityCode) : null,
      refType: 'employee',
      refId: String(r.refId),
    }))
  }

  const payrollIds = await getClosedPayrollIdsForMonth(db, scope.month, scope.year)
  const payables = await getCreditorPayables(db, payrollIds)
  const bankRows = await db.select({ id: banks.id, entityCode: banks.achEntityCode }).from(banks)
  const entityByBank = new Map<string, string | null>(
    (bankRows as Array<{ id: string; entityCode: string | null }>).map((b) => [
      String(b.id),
      b.entityCode ? String(b.entityCode) : null,
    ])
  )
  return payables
    .filter((p) => p.paymentMethod === 'ach')
    .map((p) => ({
      identification: p.identification ?? '',
      name: p.beneficiaryName,
      amount: p.amount,
      accountNumber: p.accountNumber,
      accountType: p.accountType,
      bankId: p.bankId,
      routing: p.bankRouting,
      entityCode: p.bankId ? (entityByBank.get(p.bankId) ?? null) : null,
      refType: 'creditor',
      refId: p.beneficiaryId,
    }))
}

function achLineRow(r: AchRow): Record<string, unknown> {
  return {
    employeeId: r.refType === 'employee' ? r.refId : null,
    creditorId: r.refType === 'creditor' ? r.refId : null,
    beneficiaryType: r.refType,
    beneficiaryName: r.name,
    identification: r.identification || null,
    bankRouting: r.routing,
    accountNumber: r.accountNumber ?? '',
    accountType: r.accountType ?? 'checking',
    amount: r.amount.toFixed(2),
  }
}

// ─── Banco Nacional (líneas L) ──────────────────────────────────────────────

export async function generateBancoNacionalFile(
  db: AnyDb,
  input: { paymentRunId?: string | null; scope: AchScope; sourceBankId: string; description?: string },
  options: { generatedBy?: string | null } = {}
): Promise<GenerateResult> {
  const meta = await scopeMeta(db, input.scope)
  if (!meta.ok) return { success: false, error: meta.error }

  const rows = await gatherAchRows(db, input.scope)
  const eligible = rows.filter((r) => r.accountNumber && r.routing && r.bankId === input.sourceBankId)
  const entries: BancoNacionalEntry[] = eligible.map((r) => ({
    identification: r.identification,
    beneficiaryName: r.name,
    amount: r.amount,
    routing: String(r.routing),
    accountNumber: String(r.accountNumber),
  }))

  if (entries.length === 0) {
    return {
      success: false,
      error: 'No hay beneficiarios ACH en ese banco con cuenta y ruta configuradas.',
    }
  }

  const description = input.description ?? meta.description
  const result = generateBancoNacionalText(entries, { description })
  const fileName =
    input.scope.beneficiary === 'creditors'
      ? `BNP_acreedores_${meta.dateCompact}.txt`
      : `BNP_${meta.dateCompact}.txt`

  const batchId = await storeBatch(
    db,
    {
      paymentRunId: input.paymentRunId,
      sourceBankId: input.sourceBankId,
      format: 'banco_nacional',
      fileName,
      content: result.content,
      recordCount: result.recordCount,
      totalAmount: result.totalAmount,
    },
    options,
    eligible.map(achLineRow)
  )

  return { success: true, data: { batchId, fileName, format: 'banco_nacional', ...result } }
}

// ─── Banco General (Cabecera/Detalle/Totales) ───────────────────────────────

export async function generateBancoGeneralFile(
  db: AnyDb,
  input: { paymentRunId?: string | null; scope: AchScope; sourceBankId: string; description?: string },
  options: { generatedBy?: string | null } = {}
): Promise<GenerateResult> {
  const meta = await scopeMeta(db, input.scope)
  if (!meta.ok) return { success: false, error: meta.error }

  const rows = await gatherAchRows(db, input.scope)
  const eligible = rows.filter((r) => r.accountNumber)
  const description = input.description ?? meta.description

  const entries: BancoGeneralEntry[] = eligible.map((r) => ({
    beneficiaryName: r.name,
    amount: r.amount,
    accountNumber: String(r.accountNumber),
    accountType: r.accountType ?? 'checking',
    bankCode: String(r.entityCode ?? r.routing ?? ''),
    onUs: Boolean(r.bankId) && r.bankId === input.sourceBankId,
    description,
  }))

  if (entries.length === 0) {
    return { success: false, error: 'No hay beneficiarios ACH con cuenta configurada.' }
  }

  const result = generateBancoGeneralText(entries)
  const fileName = `ACH_${meta.year}${pad2(meta.month)}_${Date.now()}.txt`

  const batchId = await storeBatch(
    db,
    {
      paymentRunId: input.paymentRunId,
      sourceBankId: input.sourceBankId,
      format: 'banco_general',
      fileName,
      content: result.content,
      recordCount: result.recordCount,
      totalAmount: result.totalAmount,
    },
    options,
    eligible.map(achLineRow)
  )

  return { success: true, data: { batchId, fileName, format: 'banco_general', ...result } }
}

// ─── Bloqueo presupuestario quincenal (reporte de control) ──────────────────

export async function generateBloqueoQuincenalFile(
  db: AnyDb,
  input: { paymentRunId?: string | null; payrollId: string },
  options: { generatedBy?: string | null } = {}
): Promise<GenerateResult> {
  const payroll = await getPayroll(db, input.payrollId)
  if (!payroll) return { success: false, error: 'Planilla no encontrada.' }
  if (payroll.status !== 'closed') {
    return { success: false, error: 'La planilla debe estar cerrada para generar el archivo.' }
  }

  const rows = await db
    .select({
      partida: budgetItems.code,
      total: sql<string>`SUM(CAST(${payrollLines.grossAmount} AS NUMERIC))`,
    })
    .from(payrollLines)
    .innerJoin(employees, eq(employees.id, payrollLines.employeeId))
    .innerJoin(positions, eq(positions.id, employees.positionId))
    .innerJoin(budgetItems, eq(budgetItems.id, positions.budgetItemId))
    .where(eq(payrollLines.payrollId, input.payrollId))
    .groupBy(budgetItems.code)
    .orderBy(asc(budgetItems.code))

  const partidas: BloqueoQuincenalPartida[] = (rows as Array<{ partida: string; total: string }>).map(
    (r) => ({ partida: r.partida, total: Number(r.total ?? 0) })
  )

  if (partidas.length === 0) {
    return { success: false, error: 'No hay partidas asociadas a las posiciones de esta planilla.' }
  }

  const entityName = await getCompanyName(db)
  const ministerioCode = partidas[0]?.partida.slice(0, 3) ?? ''
  const half = halfFromPaymentDate(payroll.paymentDate)
  const month = Number((payroll.paymentDate ?? payroll.periodEnd).slice(5, 7))
  const year = Number((payroll.paymentDate ?? payroll.periodEnd).slice(0, 4))

  const result = generateBloqueoQuincenalText(partidas, {
    entityName,
    ministerioCode,
    paymentDateLabel: payroll.paymentDate ?? payroll.periodEnd,
    month,
    year,
    half,
  })

  const quincena = half === 1 ? 'PRIMERA_QUINCENA' : 'SEGUNDA_QUINCENA'
  const fileName = `Bloqueo_${quincena}_${monthNameEs(month)}_${year}.txt`

  const batchId = await storeBatch(
    db,
    {
      paymentRunId: input.paymentRunId,
      format: 'bloqueo_quincenal',
      fileName,
      content: result.content,
      recordCount: result.recordCount,
      totalAmount: result.totalAmount,
    },
    options
  )

  return { success: true, data: { batchId, fileName, format: 'bloqueo_quincenal', ...result } }
}

// ─── Bloqueo presupuestario mensual (fichero SIAFPA) ────────────────────────

export async function generateBloqueoMensualFile(
  db: AnyDb,
  input: { month: number; year: number },
  options: { generatedBy?: string | null } = {}
): Promise<GenerateResult> {
  const base = await db
    .select({
      partida: budgetItems.code,
      total: sql<string>`SUM(CAST(${positions.salary} AS NUMERIC))`,
    })
    .from(positions)
    .innerJoin(budgetItems, eq(budgetItems.id, positions.budgetItemId))
    .groupBy(budgetItems.code)
    .orderBy(asc(budgetItems.code))

  const representation = await db
    .select({
      partida: budgetItems.code,
      total: sql<string>`SUM(CAST(${positions.representationAmount} AS NUMERIC))`,
    })
    .from(positions)
    .innerJoin(budgetItems, eq(budgetItems.id, positions.representationBudgetItemId))
    .where(sql`CAST(${positions.representationAmount} AS NUMERIC) > 0`)
    .groupBy(budgetItems.code)
    .orderBy(asc(budgetItems.code))

  const entries: BloqueoMensualEntry[] = [...base, ...representation].map(
    (r: { partida: string; total: string }) => ({ partida: r.partida, total: Number(r.total ?? 0) })
  )

  if (entries.length === 0) {
    return { success: false, error: 'No hay posiciones con partida presupuestaria configurada.' }
  }

  const result = generateBloqueoMensualText(entries, { month: input.month, year: input.year })
  const fileName = `Bloqueo_mensual_${monthNameEs(input.month)}_${input.year}.txt`

  const batchId = await storeBatch(
    db,
    {
      format: 'bloqueo_mensual',
      fileName,
      content: result.content,
      recordCount: result.recordCount,
      totalAmount: result.totalAmount,
    },
    options
  )

  return { success: true, data: { batchId, fileName, format: 'bloqueo_mensual', ...result } }
}
