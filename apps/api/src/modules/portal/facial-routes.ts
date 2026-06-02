/**
 * Portal-facial routes — endpoints faciales accesibles por el JWT del
 * empleado (token tipo `employee` que emite /portal/auth/login).
 *
 * Los endpoints /facial/* originales requieren permisos administrativos
 * (`facial:enroll`, `facial:mark`, `facial:read`) que un empleado del
 * portal NO tiene. Este módulo expone una superficie acotada al "yo
 * mismo" para que el app móvil pueda:
 *
 *   GET  /portal/facial/me          — ¿tengo enrolamiento activo?
 *   POST /portal/facial/enroll      — auto-enrolar mi cara
 *   POST /portal/facial/match       — verificar que esta cara es la mía
 *   POST /portal/facial/marcaciones — registrar marca (clasifica kind por
 *                                     secuencia del día)
 *
 * Reglas:
 *  - employeeId SIEMPRE se toma del JWT, nunca del body. Un empleado no
 *    puede operar contra otro.
 *  - `match` compara la cara recibida contra los enrolamientos DEL MISMO
 *    empleado del JWT (no contra todo el tenant): el match aquí es
 *    "anti-fraude", no "identificación".
 *  - `marcaciones` no recibe `kind`: lo asigna por la cantidad de marcas
 *    válidas del empleado en el día (1ª=entry, 2ª=lunch_start,
 *    3ª=lunch_end, 4ª=exit, 5+=extra). Mantiene el comportamiento del
 *    consolidador del TXT cuando todos los punches son tipo 0.
 *  - La consolidación diaria se dispara eager después de insertar.
 */
import { facialEnrollments, facialPunches } from '@payroll/db'
import type { PunchKind } from '@payroll/types'
import { and, count, eq, gte, lte } from 'drizzle-orm'
import { Elysia, t } from 'elysia'
import { type AuthUser, authPlugin } from '../../middleware/auth'
import { guardTenantMatchesToken, tenantPlugin } from '../../middleware/tenant'
import { consolidateAttendanceForEmployee } from '../facial/service'
import { cosineDistance, distanceToConfidence, normaliseEmbedding } from '../facial/vector'

// biome-ignore lint/suspicious/noExplicitAny: drizzle generic
type AnyDb = any

const EMBEDDING_DIM = 128
/** Cosine distance threshold for "this is the same face". Lower = stricter. */
const SELF_MATCH_THRESHOLD = 0.5

function guardEmployee({
  user,
  set,
}: {
  user: AuthUser | null
  set: { status: number | string }
}) {
  if (!user) {
    set.status = 401
    return { success: false, error: 'Unauthorized' }
  }
  if (user.type !== 'employee' || !user.employeeId) {
    set.status = 403
    return { success: false, error: 'Forbidden: portal employee token required' }
  }
}

/**
 * Clasifica el `kind` de una marca según cuántas marcas verificadas tenga
 * el empleado en el día. Espeja la lógica del txt-parser cuando todos los
 * punches llegan sin tipo explícito.
 */
async function classifyByDailySequence(
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

const EmbeddingBody = t.Object({
  embedding: t.Array(t.Number(), { minItems: EMBEDDING_DIM, maxItems: EMBEDDING_DIM }),
})

const EnrollBody = t.Object({
  embedding: t.Array(t.Number(), { minItems: EMBEDDING_DIM, maxItems: EMBEDDING_DIM }),
  photoUrl: t.Optional(t.String({ maxLength: 1024 })),
  qualityScore: t.Optional(t.Number({ minimum: 0, maximum: 1 })),
})

const MarcacionBody = t.Object({
  embedding: t.Optional(t.Array(t.Number(), { minItems: EMBEDDING_DIM, maxItems: EMBEDDING_DIM })),
  photoUrl: t.Optional(t.String({ maxLength: 1024 })),
  confidence: t.Optional(t.Number({ minimum: 0, maximum: 1 })),
  matchDistance: t.Optional(t.Number({ minimum: 0, maximum: 2 })),
  livenessScore: t.Optional(t.Number({ minimum: 0, maximum: 1 })),
  capturedAt: t.Optional(t.String()),
  idempotencyKey: t.String({ minLength: 8, maxLength: 100 }),
  matchedEnrollmentId: t.Optional(t.String()),
})

export const portalFacialRoutes = new Elysia({ prefix: '/portal/facial' })
  .use(authPlugin)
  .use(tenantPlugin)

  // ─── GET /portal/facial/me ─────────────────────────────────────────────
  .get(
    '/me',
    async ({ db, user, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const employeeId = user?.employeeId ?? ''
      const [row] = await db
        .select({
          id: facialEnrollments.id,
          isPrimary: facialEnrollments.isPrimary,
          enrolledAt: facialEnrollments.enrolledAt,
        })
        .from(facialEnrollments)
        .where(
          and(eq(facialEnrollments.employeeId, employeeId), eq(facialEnrollments.status, 'active'))
        )
        .orderBy(facialEnrollments.enrolledAt)
        .limit(1)
      return { success: true, data: { hasEnrollment: !!row, enrollment: row ?? null } }
    },
    { beforeHandle: [guardEmployee, guardTenantMatchesToken] }
  )

  // ─── POST /portal/facial/enroll ────────────────────────────────────────
  .post(
    '/enroll',
    async ({ db, body, user, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const employeeId = user?.employeeId as string
      const embedding = normaliseEmbedding(body.embedding)

      // ¿Ya tiene primario? Mantener el primero como primario; nuevos
      // enrollments quedan como adicionales.
      const [primary] = await db
        .select({ id: facialEnrollments.id })
        .from(facialEnrollments)
        .where(
          and(
            eq(facialEnrollments.employeeId, employeeId),
            eq(facialEnrollments.isPrimary, true),
            eq(facialEnrollments.status, 'active')
          )
        )
        .limit(1)

      const [row] = await db
        .insert(facialEnrollments)
        .values({
          employeeId,
          embedding,
          photoUrl: body.photoUrl ?? null,
          qualityScore: body.qualityScore !== undefined ? String(body.qualityScore) : null,
          isPrimary: !primary,
          notes: 'Auto-enrolado desde el app móvil',
        })
        .returning({
          id: facialEnrollments.id,
          isPrimary: facialEnrollments.isPrimary,
          enrolledAt: facialEnrollments.enrolledAt,
        })

      set.status = 201
      return { success: true, data: row }
    },
    { beforeHandle: [guardEmployee, guardTenantMatchesToken], body: EnrollBody }
  )

  // ─── POST /portal/facial/match ─────────────────────────────────────────
  //
  // Verifica que la cara recibida coincide con ALGÚN enrolamiento del
  // empleado del JWT. Útil como anti-fraude en el flujo de marcación.
  .post(
    '/match',
    async ({ db, body, user, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const employeeId = user?.employeeId as string
      const embedding = normaliseEmbedding(body.embedding)

      const rows = await db
        .select({
          id: facialEnrollments.id,
          embedding: facialEnrollments.embedding,
        })
        .from(facialEnrollments)
        .where(
          and(eq(facialEnrollments.employeeId, employeeId), eq(facialEnrollments.status, 'active'))
        )

      let best: { id: string; distance: number } | null = null
      for (const r of rows as Array<{ id: string; embedding: number[] }>) {
        const d = cosineDistance(embedding, r.embedding)
        if (!best || d < best.distance) best = { id: r.id, distance: d }
      }

      if (!best) {
        return { success: true, data: { matched: false, reason: 'no_enrollment' } }
      }
      const matched = best.distance <= SELF_MATCH_THRESHOLD
      return {
        success: true,
        data: {
          matched,
          enrollmentId: best.id,
          distance: best.distance,
          confidence: distanceToConfidence(best.distance),
        },
      }
    },
    { beforeHandle: [guardEmployee, guardTenantMatchesToken], body: EmbeddingBody }
  )

  // ─── POST /portal/facial/marcaciones ───────────────────────────────────
  //
  // Registra una marca facial del empleado. NO recibe `kind` — el backend
  // lo asigna según la cantidad de marcas que el empleado lleve hoy.
  .post(
    '/marcaciones',
    async ({ db, body, user, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const employeeId = user?.employeeId as string

      // Idempotencia: una re-emisión del mismo idempotencyKey no duplica.
      const [existing] = await db
        .select({ id: facialPunches.id, kind: facialPunches.kind })
        .from(facialPunches)
        .where(eq(facialPunches.idempotencyKey, body.idempotencyKey))
        .limit(1)
      if (existing) {
        return {
          success: true,
          data: { id: existing.id, kind: existing.kind, deduped: true },
        }
      }

      const capturedAt = body.capturedAt ? new Date(body.capturedAt) : new Date()
      if (Number.isNaN(capturedAt.getTime())) {
        set.status = 400
        return { success: false, error: 'capturedAt inválido' }
      }

      const kind = await classifyByDailySequence(db, employeeId, capturedAt)

      const [row] = await db
        .insert(facialPunches)
        .values({
          employeeId,
          kind,
          capturedAt,
          confidence: body.confidence !== undefined ? String(body.confidence) : null,
          matchDistance: body.matchDistance !== undefined ? String(body.matchDistance) : null,
          livenessScore: body.livenessScore !== undefined ? String(body.livenessScore) : null,
          photoUrl: body.photoUrl ?? null,
          matchedEnrollmentId: body.matchedEnrollmentId ?? null,
          idempotencyKey: body.idempotencyKey,
          source: 'mobile_app',
          status: 'verified',
          deviceMeta: { embeddingProvided: body.embedding !== undefined },
        })
        .returning({ id: facialPunches.id })

      // Eager-consolidate: el resumen diario queda al día sin esperar el cron.
      await consolidateAttendanceForEmployee(
        db,
        employeeId,
        capturedAt.toISOString().slice(0, 10)
      ).catch(() => {})

      set.status = 201
      return { success: true, data: { id: row.id, kind, deduped: false } }
    },
    { beforeHandle: [guardEmployee, guardTenantMatchesToken], body: MarcacionBody }
  )
