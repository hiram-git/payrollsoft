/**
 * Endpoints de consolidación y detección de ausencias.
 *
 *   POST /attendance/consolidate       — consolidar un día (o rango)
 *   POST /attendance/detect-absences   — marcar ausentes del día
 *
 * Diseñados para ser llamados por un cron del servidor o
 * manualmente desde el UI.
 */
import { Elysia, t } from 'elysia'
import { authPlugin, guardAuth, guardPermission } from '../../middleware/auth'
import { guardTenantMatchesToken, tenantPlugin } from '../../middleware/tenant'
import { consolidateDate } from './consolidation-service'

export const consolidationRoutes = new Elysia()
  .use(authPlugin)
  .use(tenantPlugin)

  .post(
    '/attendance/consolidate',
    async ({ db, body, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const date = body.date ?? new Date().toISOString().slice(0, 10)
      const result = await consolidateDate(db, date)
      return { success: true, data: result }
    },
    {
      beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('attendance:edit')],
      body: t.Object({
        date: t.Optional(t.String()),
      }),
    }
  )

  .post(
    '/attendance/consolidate/range',
    async ({ db, body, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const from = new Date(body.from)
      const to = new Date(body.to)
      if (from > to) {
        set.status = 400
        return { success: false, error: 'from must be <= to' }
      }

      const results = []
      const current = new Date(from)
      while (current <= to) {
        const dateStr = current.toISOString().slice(0, 10)
        const r = await consolidateDate(db, dateStr)
        results.push(r)
        current.setDate(current.getDate() + 1)
      }

      return {
        success: true,
        data: {
          days: results.length,
          totalProcessed: results.reduce((a, r) => a + r.processed, 0),
          totalAbsent: results.reduce((a, r) => a + r.absent, 0),
          totalErrors: results.reduce((a, r) => a + r.errors.length, 0),
          details: results,
        },
      }
    },
    {
      beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('attendance:edit')],
      body: t.Object({
        from: t.String(),
        to: t.String(),
      }),
    }
  )
