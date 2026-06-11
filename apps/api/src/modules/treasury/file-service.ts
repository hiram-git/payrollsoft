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
import { and, asc, eq, sql } from 'drizzle-orm'

// biome-ignore lint/suspicious/noExplicitAny: drizzle generic
type AnyDb = any

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

// ─── Banco Nacional (líneas L) ──────────────────────────────────────────────

export async function generateBancoNacionalFile(
  db: AnyDb,
  input: { paymentRunId?: string | null; payrollId: string; sourceBankId: string; description?: string },
  options: { generatedBy?: string | null } = {}
): Promise<GenerateResult> {
  const payroll = await getPayroll(db, input.payrollId)
  if (!payroll) return { success: false, error: 'Planilla no encontrada.' }
  if (payroll.status !== 'closed') {
    return { success: false, error: 'La planilla debe estar cerrada para generar el archivo.' }
  }

  const rows = await db
    .select({
      idNumber: employees.idNumber,
      firstName: employees.firstName,
      lastName: employees.lastName,
      netAmount: payrollLines.netAmount,
      accountNumber: employees.accountNumber,
      routing: banks.routing,
    })
    .from(payrollLines)
    .innerJoin(employees, eq(employees.id, payrollLines.employeeId))
    .leftJoin(banks, eq(banks.id, employees.bankId))
    .where(
      and(
        eq(payrollLines.payrollId, input.payrollId),
        eq(employees.bankId, input.sourceBankId),
        eq(employees.paymentMethod, 'ach')
      )
    )
    .orderBy(asc(employees.idNumber))

  const entries: BancoNacionalEntry[] = (rows as Array<Record<string, unknown>>)
    .filter((r) => r.accountNumber && r.routing)
    .map((r) => ({
      identification: String(r.idNumber ?? ''),
      beneficiaryName: `${r.firstName} ${r.lastName}`.trim(),
      amount: Number(r.netAmount ?? 0),
      routing: String(r.routing ?? ''),
      accountNumber: String(r.accountNumber ?? ''),
    }))

  if (entries.length === 0) {
    return { success: false, error: 'No hay empleados ACH en ese banco con cuenta y ruta configuradas.' }
  }

  const half = halfFromPaymentDate(payroll.paymentDate)
  const description = input.description ?? deriveDescription(payroll, half)
  const result = generateBancoNacionalText(entries, { description })

  const fileName = 'banconacionalpanama.txt'
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
    options
  )

  return { success: true, data: { batchId, fileName, format: 'banco_nacional', ...result } }
}

// ─── Banco General (Cabecera/Detalle/Totales) ───────────────────────────────

export async function generateBancoGeneralFile(
  db: AnyDb,
  input: { paymentRunId?: string | null; payrollId: string; sourceBankId: string; description?: string },
  options: { generatedBy?: string | null } = {}
): Promise<GenerateResult> {
  const payroll = await getPayroll(db, input.payrollId)
  if (!payroll) return { success: false, error: 'Planilla no encontrada.' }
  if (payroll.status !== 'closed') {
    return { success: false, error: 'La planilla debe estar cerrada para generar el archivo.' }
  }

  const rows = await db
    .select({
      firstName: employees.firstName,
      lastName: employees.lastName,
      netAmount: payrollLines.netAmount,
      accountNumber: employees.accountNumber,
      accountType: employees.accountType,
      bankId: employees.bankId,
      entityCode: banks.achEntityCode,
      routing: banks.routing,
    })
    .from(payrollLines)
    .innerJoin(employees, eq(employees.id, payrollLines.employeeId))
    .leftJoin(banks, eq(banks.id, employees.bankId))
    .where(and(eq(payrollLines.payrollId, input.payrollId), eq(employees.paymentMethod, 'ach')))
    .orderBy(asc(employees.idNumber))

  const half = halfFromPaymentDate(payroll.paymentDate)
  const description = input.description ?? deriveDescription(payroll, half)

  const entries: BancoGeneralEntry[] = (rows as Array<Record<string, unknown>>)
    .filter((r) => r.accountNumber)
    .map((r) => ({
      beneficiaryName: `${r.firstName} ${r.lastName}`.trim(),
      amount: Number(r.netAmount ?? 0),
      accountNumber: String(r.accountNumber ?? ''),
      accountType: (r.accountType ?? 'checking') as 'savings' | 'checking',
      bankCode: String(r.entityCode ?? r.routing ?? ''),
      onUs: Boolean(r.bankId) && r.bankId === input.sourceBankId,
      description,
    }))

  if (entries.length === 0) {
    return { success: false, error: 'No hay empleados ACH con cuenta configurada.' }
  }

  const result = generateBancoGeneralText(entries)
  const now = new Date()
  const fileName = `ACH_${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}_${now.getTime()}.txt`

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
    options
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
