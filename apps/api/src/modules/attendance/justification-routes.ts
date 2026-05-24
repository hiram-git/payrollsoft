/**
 * Justification endpoints for attendance absences/tardanzas.
 *
 *   POST   /attendance/justifications              — create
 *   GET    /attendance/justifications/pending       — list pending
 *   POST   /attendance/justifications/:id/approve   — approve
 *   POST   /attendance/justifications/:id/reject    — reject
 */
import { Elysia, t } from 'elysia'
import { authPlugin, guardAuth, guardPermission } from '../../middleware/auth'
import { guardTenantMatchesToken, tenantPlugin } from '../../middleware/tenant'
import {
  approveJustification,
  createJustification,
  listPendingJustifications,
  rejectJustification,
} from './justification-service'

export const justificationRoutes = new Elysia()
  .use(authPlugin)
  .use(tenantPlugin)

  .post(
    '/attendance/justifications',
    async ({ db, body, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const data = await createJustification(db, body)
      set.status = 201
      return { success: true, data }
    },
    {
      beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('attendance:mark')],
      body: t.Object({
        attendanceId: t.String(),
        employeeId: t.String(),
        employeeFileId: t.Optional(t.Nullable(t.String())),
        reason: t.Optional(t.Nullable(t.String({ maxLength: 1000 }))),
      }),
    }
  )

  .get(
    '/attendance/justifications/pending',
    async ({ db, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const data = await listPendingJustifications(db)
      return { success: true, data }
    },
    {
      beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('attendance:edit')],
    }
  )

  .post(
    '/attendance/justifications/:id/approve',
    async ({ db, params, user, body, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const result = await approveJustification(db, params.id, user?.userId ?? '', body?.notes)
      if (!result.success) {
        set.status = 422
        return { success: false, error: result.error }
      }
      return { success: true }
    },
    {
      beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('attendance:edit')],
      params: t.Object({ id: t.String() }),
      body: t.Object({ notes: t.Optional(t.String({ maxLength: 500 })) }),
    }
  )

  .post(
    '/attendance/justifications/:id/reject',
    async ({ db, params, user, body, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const result = await rejectJustification(db, params.id, user?.userId ?? '', body?.notes)
      if (!result.success) {
        set.status = 422
        return { success: false, error: result.error }
      }
      return { success: true }
    },
    {
      beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('attendance:edit')],
      params: t.Object({ id: t.String() }),
      body: t.Object({ notes: t.Optional(t.String({ maxLength: 500 })) }),
    }
  )
