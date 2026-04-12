import { getDashboardStats } from '@payroll/db'
import { Elysia } from 'elysia'
import { authPlugin, guardAuth, guardRole } from '../../middleware/auth'
import { tenantPlugin } from '../../middleware/tenant'

export const dashboardRoutes = new Elysia({ prefix: '/dashboard' })
  .use(authPlugin)
  .use(tenantPlugin)

  .get(
    '/stats',
    async ({ db, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const stats = await getDashboardStats(db)
      return { success: true, data: stats }
    },
    { beforeHandle: [guardAuth, guardRole('VIEWER')] }
  )
