/**
 * Facial-recognition routes — mounted at /facial
 *
 * Surface area:
 *
 *   Enrollments
 *     GET    /facial/enrollments              — list (filter by employeeId)
 *     POST   /facial/enrollments              — enroll an employee
 *     DELETE /facial/enrollments/:id          — revoke enrollment
 *
 *   Matching + marcaciones
 *     POST   /facial/match                    — KNN search by embedding
 *     POST   /facial/marcaciones              — kiosk batch ingestion
 *     GET    /facial/marcaciones              — list raw events
 *     POST   /facial/marcaciones/manual       — supervised manual mark
 *     POST   /facial/marcaciones/:id/justify  — justify a pending mark
 *     POST   /facial/consolidate              — re-run consolidator for a date
 *
 *   Terminals (kiosks)
 *     GET    /facial/terminals
 *     POST   /facial/terminals                — create + return one-shot token
 *     POST   /facial/terminals/:id/rotate
 *     DELETE /facial/terminals/:id
 *     POST   /facial/terminals/:id/heartbeat  — anonymous kiosk ping (token)
 *
 *   Dashboard
 *     GET    /facial/dashboard?date=YYYY-MM-DD
 */
import { Elysia, t } from 'elysia'
import { authPlugin, guardAuth, guardPermission } from '../../middleware/auth'
import { tenantPlugin } from '../../middleware/tenant'
import {
  consolidateAttendanceForDayService,
  createEnrollmentService,
  createTerminalService,
  dashboardService,
  deleteTerminalService,
  ingestMarcacionesService,
  justifyMarcacionService,
  listEnrollmentsService,
  listMarcacionesService,
  listTerminalsService,
  matchEmbeddingService,
  recordManualMarcacionService,
  recordTerminalHeartbeatService,
  revokeEnrollmentService,
  rotateTerminalTokenService,
} from './service'

const EmbeddingArray = t.Array(t.Number(), { minItems: 128, maxItems: 128 })

const EnrollBody = t.Object({
  employeeId: t.String(),
  embedding: EmbeddingArray,
  photoUrl: t.Optional(t.String()),
  qualityScore: t.Optional(t.Number({ minimum: 0, maximum: 1 })),
  isPrimary: t.Optional(t.Boolean()),
  notes: t.Optional(t.String()),
})

const MatchBody = t.Object({
  embedding: EmbeddingArray,
  terminalCode: t.Optional(t.String()),
  threshold: t.Optional(t.Number({ minimum: 0, maximum: 1 })),
})

const MarcacionItem = t.Object({
  employeeId: t.Optional(t.String()),
  kind: t.Union([
    t.Literal('entry'),
    t.Literal('exit'),
    t.Literal('lunch_start'),
    t.Literal('lunch_end'),
    t.Literal('extra'),
  ]),
  capturedAt: t.String(),
  confidence: t.Optional(t.Number()),
  matchDistance: t.Optional(t.Number()),
  livenessScore: t.Optional(t.Number()),
  matchedEnrollmentId: t.Optional(t.String()),
  photoUrl: t.Optional(t.String()),
  idempotencyKey: t.String({ minLength: 8, maxLength: 100 }),
  clientEventId: t.Optional(t.String()),
  terminalCode: t.Optional(t.String()),
  source: t.Optional(
    t.Union([t.Literal('kiosk'), t.Literal('manual'), t.Literal('admin'), t.Literal('webhook')])
  ),
  deviceMeta: t.Optional(t.Record(t.String(), t.Unknown())),
})

const MarcacionBatch = t.Object({
  items: t.Array(MarcacionItem, { minItems: 1, maxItems: 200 }),
})

const ManualBody = t.Object({
  employeeId: t.String(),
  kind: t.Union([
    t.Literal('entry'),
    t.Literal('exit'),
    t.Literal('lunch_start'),
    t.Literal('lunch_end'),
    t.Literal('extra'),
  ]),
  capturedAt: t.String(),
  justification: t.String({ minLength: 3, maxLength: 500 }),
})

const TerminalBody = t.Object({
  code: t.String({ minLength: 2, maxLength: 60 }),
  name: t.String({ minLength: 2, maxLength: 160 }),
  location: t.Optional(t.String()),
  status: t.Optional(t.Union([t.Literal('active'), t.Literal('inactive')])),
})

export const facialRoutes = new Elysia({ prefix: '/facial' })
  .use(authPlugin)
  .use(tenantPlugin)

  // ─── Enrollments ─────────────────────────────────────────────────────────
  .get(
    '/enrollments',
    async ({ db, query, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const data = await listEnrollmentsService(db, {
        employeeId: query.employeeId,
        status: query.status,
      })
      return { success: true, data }
    },
    {
      beforeHandle: [guardAuth, guardPermission('facial:read')],
      query: t.Object({
        employeeId: t.Optional(t.String()),
        status: t.Optional(t.String()),
      }),
    }
  )
  .post(
    '/enrollments',
    async ({ db, body, user, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const result = await createEnrollmentService(db, body, user?.userId)
      if (!result.success) {
        set.status = result.error === 'not_found' ? 404 : 400
        return { success: false, error: result.message }
      }
      set.status = 201
      return { success: true, data: result.data }
    },
    { beforeHandle: [guardAuth, guardPermission('facial:enroll')], body: EnrollBody }
  )
  .delete(
    '/enrollments/:id',
    async ({ db, params, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const result = await revokeEnrollmentService(db, params.id)
      if (!result.success) {
        set.status = 404
        return { success: false, error: result.message }
      }
      return { success: true }
    },
    {
      beforeHandle: [guardAuth, guardPermission('facial:enroll')],
      params: t.Object({ id: t.String() }),
    }
  )

  // ─── Matching ────────────────────────────────────────────────────────────
  .post(
    '/match',
    async ({ db, body, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const result = await matchEmbeddingService(db, body)
      return result
    },
    { beforeHandle: [guardAuth, guardPermission('facial:mark')], body: MatchBody }
  )

  // ─── Marcaciones ─────────────────────────────────────────────────────────
  .post(
    '/marcaciones',
    async ({ db, body, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const result = await ingestMarcacionesService(db, body)
      set.status = 201
      return result
    },
    { beforeHandle: [guardAuth, guardPermission('facial:mark')], body: MarcacionBatch }
  )
  .get(
    '/marcaciones',
    async ({ db, query, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const data = await listMarcacionesService(db, {
        date: query.date,
        employeeId: query.employeeId,
        from: query.from,
        to: query.to,
        status: query.status,
      })
      return { success: true, data }
    },
    {
      beforeHandle: [guardAuth, guardPermission('facial:read')],
      query: t.Object({
        date: t.Optional(t.String()),
        employeeId: t.Optional(t.String()),
        from: t.Optional(t.String()),
        to: t.Optional(t.String()),
        status: t.Optional(t.String()),
      }),
    }
  )
  .post(
    '/marcaciones/manual',
    async ({ db, body, user, set }) => {
      if (!db || !user) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const result = await recordManualMarcacionService(db, body, user.userId)
      set.status = 201
      return result
    },
    { beforeHandle: [guardAuth, guardPermission('facial:override')], body: ManualBody }
  )
  .post(
    '/marcaciones/:id/justify',
    async ({ db, params, body, user, set }) => {
      if (!db || !user) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const result = await justifyMarcacionService(db, params.id, body.justification, user.userId)
      if (!result.success) {
        set.status = 404
        return { success: false, error: result.message }
      }
      return { success: true }
    },
    {
      beforeHandle: [guardAuth, guardPermission('facial:override')],
      params: t.Object({ id: t.String() }),
      body: t.Object({ justification: t.String({ minLength: 3, maxLength: 500 }) }),
    }
  )
  .post(
    '/consolidate',
    async ({ db, query, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      if (!query.date) {
        set.status = 400
        return { success: false, error: 'date query parameter required' }
      }
      return consolidateAttendanceForDayService(db, query.date)
    },
    {
      beforeHandle: [guardAuth, guardPermission('facial:override')],
      query: t.Object({ date: t.String() }),
    }
  )

  // ─── Dashboard ───────────────────────────────────────────────────────────
  .get(
    '/dashboard',
    async ({ db, query, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const date = query.date ?? new Date().toISOString().slice(0, 10)
      return dashboardService(db, date)
    },
    {
      beforeHandle: [guardAuth, guardPermission('facial:read')],
      query: t.Object({ date: t.Optional(t.String()) }),
    }
  )

  // ─── Terminals ───────────────────────────────────────────────────────────
  .get(
    '/terminals',
    async ({ db, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const data = await listTerminalsService(db)
      return { success: true, data }
    },
    { beforeHandle: [guardAuth, guardPermission('terminals:read')] }
  )
  .post(
    '/terminals',
    async ({ db, body, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const result = await createTerminalService(db, body)
      if (!result.success) {
        set.status = result.error === 'conflict' ? 409 : 400
        return { success: false, error: result.message }
      }
      set.status = 201
      return { success: true, data: result.data }
    },
    { beforeHandle: [guardAuth, guardPermission('terminals:write')], body: TerminalBody }
  )
  .post(
    '/terminals/:id/rotate',
    async ({ db, params, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const result = await rotateTerminalTokenService(db, params.id)
      if (!result.success) {
        set.status = 404
        return { success: false, error: result.message }
      }
      return { success: true, data: result.data }
    },
    {
      beforeHandle: [guardAuth, guardPermission('terminals:write')],
      params: t.Object({ id: t.String() }),
    }
  )
  .delete(
    '/terminals/:id',
    async ({ db, params, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const result = await deleteTerminalService(db, params.id)
      if (!result.success) {
        set.status = 404
        return { success: false, error: result.message }
      }
      return { success: true }
    },
    {
      beforeHandle: [guardAuth, guardPermission('terminals:write')],
      params: t.Object({ id: t.String() }),
    }
  )
  .post(
    '/terminals/:id/heartbeat',
    async ({ db, params, body, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      return recordTerminalHeartbeatService(db, params.id, body)
    },
    {
      beforeHandle: [guardAuth, guardPermission('facial:mark')],
      params: t.Object({ id: t.String() }),
      body: t.Record(t.String(), t.Unknown()),
    }
  )
