/**
 * GET /attendance/punches — unified punch timeline
 *
 * Merges both attendance_punches and facial_punches into a single
 * sorted list. Filters: date, from, to, employeeId, source.
 */
import { Elysia, t } from 'elysia'
import { type AuthUser, authPlugin, guardAuth, userHasPermissions } from '../../middleware/auth'
import { guardTenantMatchesToken, tenantPlugin } from '../../middleware/tenant'
import { listUnifiedPunches } from './unified-service'

/**
 * Guard del timeline: usuarios tenant/super-admin necesitan
 * `attendance:read`; los empleados (token del portal) pueden leer, pero
 * el handler los acota a SUS propias marcaciones.
 */
function guardCanReadPunches({
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
  if (user.type === 'employee') return
  if (!userHasPermissions(user, ['attendance:read'])) {
    set.status = 403
    return { success: false, error: 'Forbidden: missing permission' }
  }
}

export const unifiedPunchRoutes = new Elysia()
  .use(authPlugin)
  .use(tenantPlugin)

  .get(
    '/attendance/punches',
    async ({ db, query, set, user }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      // Un empleado solo ve lo suyo: se ignora cualquier employeeId del
      // query y se fuerza el del token.
      const employeeId =
        user?.type === 'employee' ? user.employeeId : query.employeeId?.trim() || undefined
      const data = await listUnifiedPunches(
        db,
        {
          date: query.date?.trim() || undefined,
          from: query.from?.trim() || undefined,
          to: query.to?.trim() || undefined,
          employeeId,
          source: query.source?.trim() || undefined,
        },
        query.limit ? Math.min(500, Math.max(1, Number(query.limit))) : 200
      )
      return { success: true, data }
    },
    {
      beforeHandle: [guardAuth, guardTenantMatchesToken, guardCanReadPunches],
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
