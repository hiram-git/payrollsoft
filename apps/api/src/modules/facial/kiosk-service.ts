/**
 * Kiosk facial service — flujo multiempleado del app móvil en modo kiosko.
 *
 * Identificación 1:1: el operador teclea la cédula del empleado y la
 * cámara verifica que la cara coincida con SU enrolamiento (no contra
 * todo el tenant). Esto evita falsos positivos de la búsqueda 1:N en
 * dispositivos compartidos y mantiene el flujo "sin botones de tipo": el
 * `kind` de la marca lo decide el backend por la secuencia diaria.
 *
 * Auth: lo invocan rutas que ya exigen un JWT de usuario tenant con
 * `facial:mark` (igual que el kiosk web). El servicio es puro respecto a
 * auth: recibe el `db` ya resuelto por tenant.
 */
import { employees, facialEnrollments, facialPunches } from '@payroll/db'
import type { PunchKind } from '@payroll/types'
import { and, count, eq, gte, lte } from 'drizzle-orm'
import { consolidateAttendanceForEmployee } from './service'
import { cosineDistance, distanceToConfidence, normaliseEmbedding } from './vector'

// biome-ignore lint/suspicious/noExplicitAny: intentional generic db type
type AnyDb = any

/** Cosine distance threshold for a 1:1 face verification. Lower = stricter. */
const VERIFY_THRESHOLD = 0.5

export type KioskEmployeeLookup = {
  found: boolean
  employee?: {
    id: string
    code: string
    firstName: string
    lastName: string
    hasEnrollment: boolean
  }
}

/**
 * Resuelve un empleado por cédula (id_number) dentro del tenant e indica
 * si tiene un enrolamiento facial activo.
 */
export async function lookupKioskEmployeeService(
  db: AnyDb,
  idNumber: string
): Promise<KioskEmployeeLookup> {
  const [emp] = await db
    .select({
      id: employees.id,
      code: employees.code,
      firstName: employees.firstName,
      lastName: employees.lastName,
      isActive: employees.isActive,
    })
    .from(employees)
    .where(eq(employees.idNumber, idNumber.trim()))
    .limit(1)

  if (!emp || !emp.isActive) return { found: false }

  const [enr] = await db
    .select({ id: facialEnrollments.id })
    .from(facialEnrollments)
    .where(and(eq(facialEnrollments.employeeId, emp.id), eq(facialEnrollments.status, 'active')))
    .limit(1)

  return {
    found: true,
    employee: {
      id: emp.id,
      code: emp.code,
      firstName: emp.firstName,
      lastName: emp.lastName,
      hasEnrollment: !!enr,
    },
  }
}

/**
 * Clasifica el `kind` de una marca según cuántas marcas tenga el empleado
 * en el día. Espeja la lógica del txt-parser cuando los punches llegan
 * sin tipo explícito (1ª=entry, 2ª=lunch_start, 3ª=lunch_end, 4ª=exit).
 */
export async function classifyByDailySequence(
  db: AnyDb,
  employeeId: string,
  capturedAt: Date
): Promise<PunchKind> {
  const dayStart = new Date(capturedAt)
  dayStart.setHours(0, 0, 0, 0)
  const dayEnd = new Date(capturedAt)
  dayEnd.setHours(23, 59, 59, 999)

  const [row] = await db
    .select({ n: count() })
    .from(facialPunches)
    .where(
      and(
        eq(facialPunches.employeeId, employeeId),
        gte(facialPunches.capturedAt, dayStart),
        lte(facialPunches.capturedAt, dayEnd)
      )
    )
  const prior = Number(row?.n ?? 0)
  switch (prior) {
    case 0:
      return 'entry'
    case 1:
      return 'lunch_start'
    case 2:
      return 'lunch_end'
    case 3:
      return 'exit'
    default:
      return 'extra'
  }
}

export type KioskVerifyMarkInput = {
  employeeId: string
  embedding: number[]
  photoUrl?: string
  livenessScore?: number
  capturedAt?: string
  idempotencyKey: string
  terminalId?: string | null
}

export type KioskVerifyMarkResult =
  | { success: true; data: { id: string; kind: PunchKind; deduped: boolean; confidence: number } }
  | { success: false; error: string; code: 'no_enrollment' | 'no_match' | 'bad_request' }

/**
 * Verifica 1:1 que el embedding recibido coincide con el enrolamiento del
 * empleado indicado y, si coincide, registra la marca clasificándola por
 * secuencia. employeeId YA debe estar resuelto (por cédula) por el caller.
 */
export async function kioskVerifyAndMarkService(
  db: AnyDb,
  input: KioskVerifyMarkInput
): Promise<KioskVerifyMarkResult> {
  const probe = normaliseEmbedding(input.embedding)

  const enrollments = await db
    .select({ id: facialEnrollments.id, embedding: facialEnrollments.embedding })
    .from(facialEnrollments)
    .where(
      and(
        eq(facialEnrollments.employeeId, input.employeeId),
        eq(facialEnrollments.status, 'active')
      )
    )

  if (enrollments.length === 0) {
    return { success: false, error: 'El empleado no tiene cara registrada.', code: 'no_enrollment' }
  }

  let best: { id: string; distance: number } | null = null
  for (const e of enrollments as Array<{ id: string; embedding: number[] }>) {
    const d = cosineDistance(probe, e.embedding)
    if (!best || d < best.distance) best = { id: e.id, distance: d }
  }
  if (!best || best.distance > VERIFY_THRESHOLD) {
    return {
      success: false,
      error: 'La cara no coincide con la del empleado indicado.',
      code: 'no_match',
    }
  }

  // Idempotencia: re-emisión del mismo key no duplica.
  const [existing] = await db
    .select({ id: facialPunches.id, kind: facialPunches.kind })
    .from(facialPunches)
    .where(eq(facialPunches.idempotencyKey, input.idempotencyKey))
    .limit(1)
  if (existing) {
    return {
      success: true,
      data: {
        id: existing.id,
        kind: existing.kind as PunchKind,
        deduped: true,
        confidence: distanceToConfidence(best.distance),
      },
    }
  }

  const capturedAt = input.capturedAt ? new Date(input.capturedAt) : new Date()
  if (Number.isNaN(capturedAt.getTime())) {
    return { success: false, error: 'capturedAt inválido', code: 'bad_request' }
  }

  const kind = await classifyByDailySequence(db, input.employeeId, capturedAt)

  const [row] = await db
    .insert(facialPunches)
    .values({
      employeeId: input.employeeId,
      terminalId: input.terminalId ?? null,
      kind,
      capturedAt,
      confidence: String(distanceToConfidence(best.distance)),
      matchDistance: String(best.distance),
      livenessScore: input.livenessScore !== undefined ? String(input.livenessScore) : null,
      photoUrl: input.photoUrl ?? null,
      matchedEnrollmentId: best.id,
      idempotencyKey: input.idempotencyKey,
      source: 'mobile_app',
      status: 'verified',
      deviceMeta: { kiosk: true },
    })
    .returning({ id: facialPunches.id })

  await consolidateAttendanceForEmployee(
    db,
    input.employeeId,
    capturedAt.toISOString().slice(0, 10)
  ).catch(() => {})

  return {
    success: true,
    data: { id: row.id, kind, deduped: false, confidence: distanceToConfidence(best.distance) },
  }
}
