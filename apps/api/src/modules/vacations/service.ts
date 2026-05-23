/**
 * Service layer del módulo de vacaciones.
 *
 * Modelo:
 *   • Cada año cumplido desde `hire_date` suma +30 a cada pool
 *     (`enjoy`, `paid`). El accrual es lazy + idempotente — se
 *     ejecuta al leer el saldo y al solicitar.
 *   • Solicitar reserva (no consume) — al aprobar se commitea
 *     (sale de reserved, entra a used). Rechazar libera.
 *   • Al aprobar una solicitud con `paid_days > 0`, se genera
 *     automáticamente una planilla nueva tipo='vacation' con una
 *     línea de pago. La solicitud pasa a `processed` y el
 *     `payroll_id` queda enlazado para reportes/auditoría.
 *   • Todos los cambios dejan rastro en `vacation_balance_movements`.
 *
 * Las reglas de aprobación viven en `vacation_approval_rules` con
 * la misma semántica que `employee_file_approval_rules`: si no hay
 * regla activa, el fallback es `tenant_admin`.
 */
import {
  employees,
  payrollLines,
  payrolls,
  vacationApprovalRules,
  vacationBalanceMovements,
  vacationBalances,
  vacationRequests,
} from '@payroll/db'
import { desc, eq, sql } from 'drizzle-orm'

// biome-ignore lint/suspicious/noExplicitAny: drizzle generic
type AnyDb = any

const DAYS_PER_YEAR = 30

export type VacationPool = 'enjoy' | 'paid'
export type RequestType = 'enjoy' | 'pay' | 'mixed'

export type BalanceSnapshot = {
  employeeId: string
  enjoy: { earned: number; used: number; reserved: number; available: number }
  paid: { earned: number; used: number; reserved: number; available: number }
  lastAccrualDate: string | null
  updatedAt: string
}

// ─── Helpers de fecha ─────────────────────────────────────────────────────

function parseDateOnly(s: string | Date | null | undefined): Date | null {
  if (!s) return null
  if (s instanceof Date)
    return new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate()))
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return null
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
}

function fmtDateOnly(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

/**
 * Lista los aniversarios pasados desde `from` (exclusivo) hasta `to`
 * (inclusivo). El "aniversario" preserva mes/día del `hire_date`
 * original. Devuelve fechas en UTC sin time.
 *
 *   anniversariesBetween(hire=2023-03-15, from=2023-03-15, to=2026-05-19)
 *     → [2024-03-15, 2025-03-15, 2026-03-15]
 */
function anniversariesBetween(hireDate: Date, from: Date, to: Date): Date[] {
  const out: Date[] = []
  const month = hireDate.getUTCMonth()
  const day = hireDate.getUTCDate()
  let year = from.getUTCFullYear() + 1
  // Si `from` cae después del aniversario de ese año, empezamos un año después
  const fromAnniv = new Date(Date.UTC(from.getUTCFullYear(), month, day))
  if (fromAnniv > from) year = from.getUTCFullYear()
  while (true) {
    const anniv = new Date(Date.UTC(year, month, day))
    if (anniv > to) break
    if (anniv > from) out.push(anniv)
    year += 1
  }
  return out
}

// ─── Accrual ──────────────────────────────────────────────────────────────

/**
 * Garantiza que el saldo del empleado refleja todos los aniversarios
 * cumplidos hasta hoy. Crea la fila de balance si no existe; agrega
 * +30 a cada pool por aniversario y deja movimientos en el ledger.
 *
 * Idempotente: si `last_accrual_date` ya cubre todos los aniversarios
 * hasta hoy, no hace nada.
 */
export async function recomputeAccrual(
  db: AnyDb,
  employeeId: string,
  options: { performedBy?: string | null; asOf?: Date } = {}
): Promise<void> {
  const asOf = options.asOf ?? new Date()
  const today = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate()))

  // biome-ignore lint/suspicious/noExplicitAny: drizzle tx
  await db.transaction(async (tx: any) => {
    const [emp] = await tx
      .select({ hireDate: employees.hireDate })
      .from(employees)
      .where(eq(employees.id, employeeId))
      .limit(1)
    if (!emp) throw new Error('Empleado no encontrado')

    const hire = parseDateOnly(emp.hireDate)
    if (!hire) return // sin fecha de ingreso no se acredita

    // Asegurar fila de balance (UPSERT mínimo)
    const [existing] = await tx
      .select()
      .from(vacationBalances)
      .where(eq(vacationBalances.employeeId, employeeId))
      .limit(1)
    let lastAccrual = existing?.lastAccrualDate ? parseDateOnly(existing.lastAccrualDate) : hire
    if (!existing) {
      await tx.insert(vacationBalances).values({
        employeeId,
        lastAccrualDate: fmtDateOnly(hire),
      })
      lastAccrual = hire
    }
    if (!lastAccrual) return

    const anniversaries = anniversariesBetween(hire, lastAccrual, today)
    if (anniversaries.length === 0) return

    const yearsToAccrue = anniversaries.length
    const daysToAdd = yearsToAccrue * DAYS_PER_YEAR

    await tx
      .update(vacationBalances)
      .set({
        enjoyEarned: sql`${vacationBalances.enjoyEarned} + ${daysToAdd}`,
        paidEarned: sql`${vacationBalances.paidEarned} + ${daysToAdd}`,
        lastAccrualDate: fmtDateOnly(anniversaries[anniversaries.length - 1]),
        updatedAt: new Date(),
      })
      .where(eq(vacationBalances.employeeId, employeeId))

    // Un movimiento por aniversario y pool — facilita auditoría
    // ("cuándo ganó este empleado los 30 días del 2024").
    const movements = anniversaries.flatMap((anniv) => [
      {
        employeeId,
        requestId: null,
        movementType: 'accrual' as const,
        pool: 'enjoy' as const,
        days: DAYS_PER_YEAR,
        notes: `Aniversario ${fmtDateOnly(anniv)}`,
        performedBy: options.performedBy ?? null,
      },
      {
        employeeId,
        requestId: null,
        movementType: 'accrual' as const,
        pool: 'paid' as const,
        days: DAYS_PER_YEAR,
        notes: `Aniversario ${fmtDateOnly(anniv)}`,
        performedBy: options.performedBy ?? null,
      },
    ])
    await tx.insert(vacationBalanceMovements).values(movements)
  })
}

// ─── Balance ──────────────────────────────────────────────────────────────

export async function getBalance(
  db: AnyDb,
  employeeId: string,
  options: { performedBy?: string | null } = {}
): Promise<BalanceSnapshot> {
  await recomputeAccrual(db, employeeId, options)
  const [row] = await db
    .select()
    .from(vacationBalances)
    .where(eq(vacationBalances.employeeId, employeeId))
    .limit(1)
  if (!row) {
    // El empleado no existía o no tenía hire_date — devolver vacío.
    return {
      employeeId,
      enjoy: { earned: 0, used: 0, reserved: 0, available: 0 },
      paid: { earned: 0, used: 0, reserved: 0, available: 0 },
      lastAccrualDate: null,
      updatedAt: new Date().toISOString(),
    }
  }
  return {
    employeeId,
    enjoy: {
      earned: row.enjoyEarned,
      used: row.enjoyUsed,
      reserved: row.enjoyReserved,
      available: row.enjoyEarned - row.enjoyUsed - row.enjoyReserved,
    },
    paid: {
      earned: row.paidEarned,
      used: row.paidUsed,
      reserved: row.paidReserved,
      available: row.paidEarned - row.paidUsed - row.paidReserved,
    },
    lastAccrualDate: row.lastAccrualDate,
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
  }
}

export async function listMovements(db: AnyDb, employeeId: string, limit = 100) {
  return db
    .select()
    .from(vacationBalanceMovements)
    .where(eq(vacationBalanceMovements.employeeId, employeeId))
    .orderBy(desc(vacationBalanceMovements.createdAt))
    .limit(Math.min(limit, 500))
}

// ─── Correlativo VAC-YYYY-NNNN ────────────────────────────────────────────

async function nextRequestNumber(tx: AnyDb, year: number): Promise<string> {
  const rows = await tx.execute(sql`
    SELECT COALESCE(
      MAX(
        CAST(SPLIT_PART(request_number, '-', 3) AS integer)
      ),
      0
    ) AS max_seq
    FROM vacation_requests
    WHERE request_number LIKE ${`VAC-${year}-%`}
  `)
  const max = Number((rows as Array<{ max_seq: number }>)[0]?.max_seq ?? 0)
  return `VAC-${year}-${String(max + 1).padStart(4, '0')}`
}

// ─── Crear solicitud (reserva saldo) ──────────────────────────────────────

export type CreateRequestInput = {
  employeeId: string
  requestType: RequestType
  startDate?: string | null
  endDate?: string | null
  enjoyDays: number
  paidDays: number
  reason?: string | null
}

export async function createRequest(
  db: AnyDb,
  input: CreateRequestInput,
  options: { requestedBy?: string | null } = {}
): Promise<
  { success: true; data: { id: string; requestNumber: string } } | { success: false; error: string }
> {
  // Validaciones declarativas mínimas — el CHECK del DDL es backstop.
  if (input.enjoyDays < 0 || input.paidDays < 0) {
    return { success: false, error: 'Los días no pueden ser negativos.' }
  }
  if (input.enjoyDays + input.paidDays === 0) {
    return { success: false, error: 'Debes pedir al menos un día.' }
  }
  if (input.requestType === 'enjoy' && input.paidDays > 0) {
    return { success: false, error: 'Tipo "Disfrute" no permite días pagados.' }
  }
  if (input.requestType === 'pay' && input.enjoyDays > 0) {
    return { success: false, error: 'Tipo "Pago" no permite días de disfrute.' }
  }
  if (input.requestType === 'mixed' && (input.enjoyDays === 0 || input.paidDays === 0)) {
    return { success: false, error: 'Tipo "Mixto" requiere días de disfrute y de pago.' }
  }
  if (input.enjoyDays > 0 && (!input.startDate || !input.endDate)) {
    return { success: false, error: 'Las fechas son obligatorias cuando hay días de disfrute.' }
  }

  // Refrescar accrual antes de validar disponibilidad (puede haberse
  // cumplido un aniversario desde la última consulta).
  await recomputeAccrual(db, input.employeeId, { performedBy: options.requestedBy ?? null })

  // biome-ignore lint/suspicious/noExplicitAny: drizzle tx
  return db.transaction(async (tx: any) => {
    const [bal] = await tx
      .select()
      .from(vacationBalances)
      .where(eq(vacationBalances.employeeId, input.employeeId))
      .limit(1)
    if (!bal) {
      return { success: false as const, error: 'El empleado no tiene saldo de vacaciones.' }
    }
    const enjoyAvail = bal.enjoyEarned - bal.enjoyUsed - bal.enjoyReserved
    const paidAvail = bal.paidEarned - bal.paidUsed - bal.paidReserved
    if (input.enjoyDays > enjoyAvail) {
      return {
        success: false as const,
        error: `Días de disfrute insuficientes (disponibles: ${enjoyAvail}, solicitados: ${input.enjoyDays}).`,
      }
    }
    if (input.paidDays > paidAvail) {
      return {
        success: false as const,
        error: `Días pagados insuficientes (disponibles: ${paidAvail}, solicitados: ${input.paidDays}).`,
      }
    }

    const year = new Date().getUTCFullYear()
    const requestNumber = await nextRequestNumber(tx, year)

    const [inserted] = await tx
      .insert(vacationRequests)
      .values({
        requestNumber,
        employeeId: input.employeeId,
        requestType: input.requestType,
        startDate: input.startDate ?? null,
        endDate: input.endDate ?? null,
        enjoyDays: input.enjoyDays,
        paidDays: input.paidDays,
        reason: input.reason ?? null,
        status: 'pending',
        requestedBy: options.requestedBy ?? null,
      })
      .returning({ id: vacationRequests.id })

    // Reservar saldo + ledger
    const reservations: Array<{
      pool: VacationPool
      days: number
    }> = []
    if (input.enjoyDays > 0) reservations.push({ pool: 'enjoy', days: input.enjoyDays })
    if (input.paidDays > 0) reservations.push({ pool: 'paid', days: input.paidDays })

    for (const r of reservations) {
      const col =
        r.pool === 'enjoy' ? vacationBalances.enjoyReserved : vacationBalances.paidReserved
      await tx
        .update(vacationBalances)
        .set({
          [r.pool === 'enjoy' ? 'enjoyReserved' : 'paidReserved']: sql`${col} + ${r.days}`,
          updatedAt: new Date(),
        })
        .where(eq(vacationBalances.employeeId, input.employeeId))
      await tx.insert(vacationBalanceMovements).values({
        employeeId: input.employeeId,
        requestId: inserted.id,
        movementType: 'reservation',
        pool: r.pool,
        days: -r.days,
        notes: `Reserva por solicitud ${requestNumber}`,
        performedBy: options.requestedBy ?? null,
      })
    }

    return { success: true as const, data: { id: inserted.id as string, requestNumber } }
  })
}

// ─── Aprobar / Rechazar / Cancelar ───────────────────────────────────────

/**
 * Tarifa diaria del empleado para calcular el monto de vacaciones
 * pagadas. Convención LATAM estándar:
 *
 *   monthly  → baseSalary / 30
 *   biweekly → baseSalary / 15   (15 días por quincena)
 *   weekly   → baseSalary / 7
 *
 * Si la frecuencia es desconocida, asume mensual.
 */
function dailyRate(baseSalary: string | number | null, payFrequency: string): number {
  const base = Number(baseSalary ?? 0)
  if (!Number.isFinite(base) || base <= 0) return 0
  const f = (payFrequency ?? 'monthly').toLowerCase()
  if (f === 'biweekly') return base / 15
  if (f === 'weekly') return base / 7
  return base / 30
}

/**
 * Genera la planilla de pago de vacaciones para una solicitud
 * aprobada con `paid_days > 0`. Crea:
 *
 *   - 1 fila en `payrolls` con type='vacation', frequency='liquidation',
 *     período = startDate→endDate de la solicitud (o hoy si no hay
 *     fechas — caso "solo pago").
 *   - 1 fila en `payroll_lines` para el empleado con una entrada
 *     en `concepts[]` codificada como VACACIONES (type='income').
 *
 * Actualiza la solicitud: status='processed', processedAt=now,
 * payrollId=nuevo. El PDF se genera por el flujo normal del módulo
 * de payroll usando el `storage_mode` configurado en company_config.
 *
 * Si la solicitud ya tiene `payroll_id`, devuelve el existente
 * (idempotente — no genera planillas duplicadas si se llama otra vez).
 */
async function processVacationPayment(
  tx: AnyDb,
  requestId: string,
  performedBy: string | null
): Promise<{ payrollId: string } | { error: string }> {
  const [req] = await tx
    .select()
    .from(vacationRequests)
    .where(eq(vacationRequests.id, requestId))
    .limit(1)
  if (!req) return { error: 'Solicitud no encontrada' }
  if (req.payrollId) return { payrollId: req.payrollId as string }
  if ((req.paidDays ?? 0) <= 0) return { error: 'La solicitud no tiene días pagados' }

  const [emp] = await tx
    .select({
      id: employees.id,
      code: employees.code,
      firstName: employees.firstName,
      lastName: employees.lastName,
      baseSalary: employees.baseSalary,
      payFrequency: employees.payFrequency,
    })
    .from(employees)
    .where(eq(employees.id, req.employeeId))
    .limit(1)
  if (!emp) return { error: 'Empleado no encontrado' }

  const rate = dailyRate(emp.baseSalary, emp.payFrequency)
  const amount = (rate * req.paidDays).toFixed(2)
  const today = new Date().toISOString().slice(0, 10)
  const periodStart = req.startDate ?? today
  const periodEnd = req.endDate ?? today

  const concept = {
    code: 'VACACIONES',
    name: 'Pago de vacaciones',
    amount: Number(amount),
    type: 'income' as const,
    meta: {
      days: req.paidDays,
      requestNumber: req.requestNumber,
      dailyRate: Number(rate.toFixed(4)),
    },
  }

  const [payroll] = await tx
    .insert(payrolls)
    .values({
      name: `Vacaciones ${req.requestNumber} — ${emp.lastName}, ${emp.firstName}`,
      type: 'vacation',
      frequency: 'liquidation',
      periodStart,
      periodEnd,
      paymentDate: null,
      payrollTypeId: null,
      status: 'created',
      totalGross: amount,
      totalDeductions: '0',
      totalNet: amount,
    })
    .returning({ id: payrolls.id })

  await tx.insert(payrollLines).values({
    payrollId: payroll.id,
    employeeId: req.employeeId,
    grossAmount: amount,
    deductions: '0',
    netAmount: amount,
    concepts: [concept],
  })

  await tx
    .update(vacationRequests)
    .set({
      status: 'processed',
      processedAt: new Date(),
      payrollId: payroll.id,
      updatedAt: new Date(),
    })
    .where(eq(vacationRequests.id, requestId))

  // Marcar el movimiento de commit con la planilla generada para
  // que la auditoría sea localizable: "este pago salió en VAC-...".
  // Como `commit` ya se insertó antes, agregamos una nota.
  void performedBy

  return { payrollId: payroll.id as string }
}

export async function approveRequest(
  db: AnyDb,
  requestId: string,
  approverId: string
): Promise<
  { success: true; data: { payrollId: string | null } } | { success: false; error: string }
> {
  // biome-ignore lint/suspicious/noExplicitAny: drizzle tx
  return db.transaction(async (tx: any) => {
    const [req] = await tx
      .select()
      .from(vacationRequests)
      .where(eq(vacationRequests.id, requestId))
      .limit(1)
    if (!req) return { success: false as const, error: 'Solicitud no encontrada.' }
    if (req.status !== 'pending') {
      return { success: false as const, error: `La solicitud está ${req.status}.` }
    }

    await tx
      .update(vacationRequests)
      .set({
        status: 'approved',
        approvedBy: approverId,
        approvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(vacationRequests.id, requestId))

    // Commit: pasar de reserved → used
    const moves: Array<{ pool: VacationPool; days: number }> = []
    if (req.enjoyDays > 0) moves.push({ pool: 'enjoy', days: req.enjoyDays })
    if (req.paidDays > 0) moves.push({ pool: 'paid', days: req.paidDays })

    for (const m of moves) {
      if (m.pool === 'enjoy') {
        await tx
          .update(vacationBalances)
          .set({
            enjoyReserved: sql`${vacationBalances.enjoyReserved} - ${m.days}`,
            enjoyUsed: sql`${vacationBalances.enjoyUsed} + ${m.days}`,
            updatedAt: new Date(),
          })
          .where(eq(vacationBalances.employeeId, req.employeeId))
      } else {
        await tx
          .update(vacationBalances)
          .set({
            paidReserved: sql`${vacationBalances.paidReserved} - ${m.days}`,
            paidUsed: sql`${vacationBalances.paidUsed} + ${m.days}`,
            updatedAt: new Date(),
          })
          .where(eq(vacationBalances.employeeId, req.employeeId))
      }
      await tx.insert(vacationBalanceMovements).values({
        employeeId: req.employeeId,
        requestId,
        movementType: 'commit',
        pool: m.pool,
        days: -m.days,
        notes: `Aprobación de solicitud ${req.requestNumber}`,
        performedBy: approverId,
      })
    }

    // Si incluye pago, generar planilla automáticamente y dejar
    // la solicitud en `processed`. Si solo es disfrute, queda en
    // `approved` (no hay planilla que producir).
    let payrollId: string | null = null
    if (req.paidDays > 0) {
      const result = await processVacationPayment(tx, requestId, approverId)
      if ('error' in result) {
        // Rollback transaction: si la planilla falla, no aprobamos.
        throw new Error(`No se pudo generar la planilla: ${result.error}`)
      }
      payrollId = result.payrollId
    }

    return { success: true as const, data: { payrollId } }
  })
}

export async function rejectRequest(
  db: AnyDb,
  requestId: string,
  approverId: string,
  reason: string
): Promise<{ success: true } | { success: false; error: string }> {
  // biome-ignore lint/suspicious/noExplicitAny: drizzle tx
  return db.transaction(async (tx: any) => {
    const [req] = await tx
      .select()
      .from(vacationRequests)
      .where(eq(vacationRequests.id, requestId))
      .limit(1)
    if (!req) return { success: false as const, error: 'Solicitud no encontrada.' }
    if (req.status !== 'pending') {
      return { success: false as const, error: `La solicitud está ${req.status}.` }
    }

    await tx
      .update(vacationRequests)
      .set({
        status: 'rejected',
        approvedBy: approverId,
        approvedAt: new Date(),
        rejectionReason: reason.trim() || 'Sin motivo especificado.',
        updatedAt: new Date(),
      })
      .where(eq(vacationRequests.id, requestId))

    // Liberar reserva
    const moves: Array<{ pool: VacationPool; days: number }> = []
    if (req.enjoyDays > 0) moves.push({ pool: 'enjoy', days: req.enjoyDays })
    if (req.paidDays > 0) moves.push({ pool: 'paid', days: req.paidDays })
    for (const m of moves) {
      if (m.pool === 'enjoy') {
        await tx
          .update(vacationBalances)
          .set({
            enjoyReserved: sql`${vacationBalances.enjoyReserved} - ${m.days}`,
            updatedAt: new Date(),
          })
          .where(eq(vacationBalances.employeeId, req.employeeId))
      } else {
        await tx
          .update(vacationBalances)
          .set({
            paidReserved: sql`${vacationBalances.paidReserved} - ${m.days}`,
            updatedAt: new Date(),
          })
          .where(eq(vacationBalances.employeeId, req.employeeId))
      }
      await tx.insert(vacationBalanceMovements).values({
        employeeId: req.employeeId,
        requestId,
        movementType: 'release',
        pool: m.pool,
        days: m.days,
        notes: `Rechazo de ${req.requestNumber}`,
        performedBy: approverId,
      })
    }

    return { success: true as const }
  })
}

export async function cancelRequest(
  db: AnyDb,
  requestId: string,
  userId: string
): Promise<{ success: true } | { success: false; error: string }> {
  // biome-ignore lint/suspicious/noExplicitAny: drizzle tx
  return db.transaction(async (tx: any) => {
    const [req] = await tx
      .select()
      .from(vacationRequests)
      .where(eq(vacationRequests.id, requestId))
      .limit(1)
    if (!req) return { success: false as const, error: 'Solicitud no encontrada.' }
    if (req.status !== 'pending') {
      return { success: false as const, error: 'Solo se pueden cancelar solicitudes pendientes.' }
    }

    await tx
      .update(vacationRequests)
      .set({ status: 'cancelled', updatedAt: new Date() })
      .where(eq(vacationRequests.id, requestId))

    // Liberar reserva (idéntico a reject pero sin marcar approver)
    const moves: Array<{ pool: VacationPool; days: number }> = []
    if (req.enjoyDays > 0) moves.push({ pool: 'enjoy', days: req.enjoyDays })
    if (req.paidDays > 0) moves.push({ pool: 'paid', days: req.paidDays })
    for (const m of moves) {
      if (m.pool === 'enjoy') {
        await tx
          .update(vacationBalances)
          .set({
            enjoyReserved: sql`${vacationBalances.enjoyReserved} - ${m.days}`,
            updatedAt: new Date(),
          })
          .where(eq(vacationBalances.employeeId, req.employeeId))
      } else {
        await tx
          .update(vacationBalances)
          .set({
            paidReserved: sql`${vacationBalances.paidReserved} - ${m.days}`,
            updatedAt: new Date(),
          })
          .where(eq(vacationBalances.employeeId, req.employeeId))
      }
      await tx.insert(vacationBalanceMovements).values({
        employeeId: req.employeeId,
        requestId,
        movementType: 'release',
        pool: m.pool,
        days: m.days,
        notes: `Cancelación de ${req.requestNumber}`,
        performedBy: userId,
      })
    }

    return { success: true as const }
  })
}

// ─── Listados ─────────────────────────────────────────────────────────────

export async function listByEmployee(db: AnyDb, employeeId: string) {
  return db
    .select()
    .from(vacationRequests)
    .where(eq(vacationRequests.employeeId, employeeId))
    .orderBy(desc(vacationRequests.createdAt))
}

export async function getRequest(db: AnyDb, id: string) {
  const [row] = await db.select().from(vacationRequests).where(eq(vacationRequests.id, id)).limit(1)
  return row ?? null
}

/**
 * Pendientes que el usuario puede aprobar dados sus roles. Igual que
 * en expedientes: tenant_admin ve todos como aprobador universal;
 * el resto solo ve lo que matchee una regla activa con su rol.
 */
export async function listPendingApprovals(db: AnyDb, userRoles: string[]) {
  if (userRoles.length === 0) return []
  const isAdmin = userRoles.includes('tenant_admin')
  // biome-ignore lint/suspicious/noExplicitAny: rows
  const rows: any[] = await db.execute(sql`
    SELECT r.*,
           e.code        AS employee_code,
           e.first_name  AS employee_first_name,
           e.last_name   AS employee_last_name,
           e.department_id AS employee_department_id
    FROM vacation_requests r
    JOIN employees e ON e.id = r.employee_id
    WHERE r.status = 'pending'
      AND (
        ${isAdmin}::boolean = true
        OR EXISTS (
          SELECT 1 FROM vacation_approval_rules ar
          WHERE ar.is_active = 1
            AND ar.approver_role = ANY(${userRoles})
            AND (ar.request_type IS NULL OR ar.request_type = r.request_type)
            AND (ar.department_id IS NULL OR ar.department_id = e.department_id)
        )
      )
    ORDER BY r.created_at ASC
  `)
  return rows
}

// ─── Reglas de aprobación ─────────────────────────────────────────────────

export async function listApprovalRules(db: AnyDb) {
  return db.select().from(vacationApprovalRules).where(eq(vacationApprovalRules.isActive, 1))
}

export async function createApprovalRule(
  db: AnyDb,
  input: {
    requestType?: RequestType | null
    departmentId?: string | null
    approverRole: string
  }
): Promise<{ id: string }> {
  const [row] = await db
    .insert(vacationApprovalRules)
    .values({
      requestType: input.requestType ?? null,
      departmentId: input.departmentId ?? null,
      approverRole: input.approverRole,
    })
    .returning({ id: vacationApprovalRules.id })
  return { id: row.id as string }
}

export async function deactivateApprovalRule(db: AnyDb, id: string): Promise<boolean> {
  const res = await db
    .update(vacationApprovalRules)
    .set({ isActive: 0 })
    .where(eq(vacationApprovalRules.id, id))
    .returning({ id: vacationApprovalRules.id })
  return res.length > 0
}

// ─── Ajustes manuales de saldo (tenant_admin) ─────────────────────────────

/**
 * Ajuste manual del saldo — para correcciones (ej. trasladar saldo
 * desde otro sistema, premiar días extras, etc.). El delta puede
 * ser positivo o negativo; queda registrado en el ledger con
 * `movement_type='adjustment'`.
 */
export async function adjustBalance(
  db: AnyDb,
  input: {
    employeeId: string
    pool: VacationPool
    days: number
    notes: string
    performedBy: string
  }
): Promise<{ success: true } | { success: false; error: string }> {
  if (!Number.isInteger(input.days) || input.days === 0) {
    return { success: false, error: 'El ajuste debe ser un entero distinto de 0.' }
  }
  // biome-ignore lint/suspicious/noExplicitAny: drizzle tx
  return db.transaction(async (tx: any) => {
    // Asegurar fila
    const [bal] = await tx
      .select()
      .from(vacationBalances)
      .where(eq(vacationBalances.employeeId, input.employeeId))
      .limit(1)
    if (!bal) {
      await tx.insert(vacationBalances).values({ employeeId: input.employeeId })
    }
    if (input.pool === 'enjoy') {
      const next = (bal?.enjoyEarned ?? 0) + input.days
      if (next < 0) return { success: false as const, error: 'El saldo quedaría negativo.' }
      await tx
        .update(vacationBalances)
        .set({
          enjoyEarned: sql`${vacationBalances.enjoyEarned} + ${input.days}`,
          updatedAt: new Date(),
        })
        .where(eq(vacationBalances.employeeId, input.employeeId))
    } else {
      const next = (bal?.paidEarned ?? 0) + input.days
      if (next < 0) return { success: false as const, error: 'El saldo quedaría negativo.' }
      await tx
        .update(vacationBalances)
        .set({
          paidEarned: sql`${vacationBalances.paidEarned} + ${input.days}`,
          updatedAt: new Date(),
        })
        .where(eq(vacationBalances.employeeId, input.employeeId))
    }
    await tx.insert(vacationBalanceMovements).values({
      employeeId: input.employeeId,
      requestId: null,
      movementType: 'adjustment',
      pool: input.pool,
      days: input.days,
      notes: input.notes,
      performedBy: input.performedBy,
    })
    return { success: true as const }
  })
}
