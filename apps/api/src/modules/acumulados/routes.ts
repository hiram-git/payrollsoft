import { getAcumuladosSummary, queryAcumulados } from '@payroll/db'
import { Elysia, t } from 'elysia'
import { authPlugin, guardAuth, guardRole } from '../../middleware/auth'
import { tenantPlugin } from '../../middleware/tenant'

const FilterQuery = t.Object({
  employeeId: t.Optional(t.String()),
  conceptCode: t.Optional(t.String()),
  conceptType: t.Optional(t.String()),
  from: t.Optional(t.String()),
  to: t.Optional(t.String()),
  page: t.Optional(t.String()),
  limit: t.Optional(t.String()),
})

export const acumuladosRoutes = new Elysia({ prefix: '/acumulados' })
  .use(authPlugin)
  .use(tenantPlugin)

  // Detail list with pagination
  .get(
    '/',
    async ({ db, query, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }

      const page = Math.max(1, Number(query.page ?? 1))
      const limit = Math.min(500, Math.max(1, Number(query.limit ?? 100)))

      const { rows, total } = await queryAcumulados(
        db,
        {
          employeeId: query.employeeId || undefined,
          conceptCode: query.conceptCode || undefined,
          conceptType: query.conceptType || undefined,
          from: query.from || undefined,
          to: query.to || undefined,
        },
        page,
        limit
      )

      return {
        success: true,
        data: rows,
        meta: { total, page, limit, pages: Math.ceil(total / limit) },
      }
    },
    { beforeHandle: [guardAuth, guardRole('VIEWER')], query: FilterQuery }
  )

  // Grouped summary (total per employee+concept)
  .get(
    '/summary',
    async ({ db, query, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }

      const rows = await getAcumuladosSummary(db, {
        employeeId: query.employeeId || undefined,
        conceptCode: query.conceptCode || undefined,
        conceptType: query.conceptType || undefined,
        from: query.from || undefined,
        to: query.to || undefined,
      })

      return { success: true, data: rows }
    },
    { beforeHandle: [guardAuth, guardRole('VIEWER')], query: FilterQuery }
  )
