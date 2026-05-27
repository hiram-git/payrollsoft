/**
 * GET /attendance/punches — unified punch timeline
 *
 * Merges both attendance_punches and facial_punches into a single
 * sorted list. Filters: date, from, to, employeeId, source.
 */
import { Elysia, t } from 'elysia'
import { authPlugin, guardAuth, guardPermission } from '../../middleware/auth'
import { guardTenantMatchesToken, tenantPlugin } from '../../middleware/tenant'
import { listUnifiedPunches } from './unified-service'

export const unifiedPunchRoutes = new Elysia()
  .use(authPlugin)
  .use(tenantPlugin)

  .get(
    '/attendance/punches',
    async ({ db, query, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const data = await listUnifiedPunches(
        db,
        {
          date: query.date?.trim() || undefined,
          from: query.from?.trim() || undefined,
          to: query.to?.trim() || undefined,
          employeeId: query.employeeId?.trim() || undefined,
          source: query.source?.trim() || undefined,
        },
        query.limit ? Math.min(500, Math.max(1, Number(query.limit))) : 200
      )
      return { success: true, data }
    },
    {
      beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('attendance:read')],
      query: t.Object({
        date: t.Optional(t.String()),
        from: t.Optional(t.String()),
        to: t.Optional(t.String()),
        employeeId: t.Optional(t.String()),
        source: t.Optional(t.String()),
        limit: t.Optional(t.String()),
      }),
    }
  )
