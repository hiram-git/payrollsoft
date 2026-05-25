import { auditLog } from '@payroll/db'
import { and, desc, eq, gte, lte, sql } from 'drizzle-orm'
import { Elysia, t } from 'elysia'
import { authPlugin, guardAuth, guardPermission } from '../../middleware/auth'
import { guardTenantMatchesToken, tenantPlugin } from '../../middleware/tenant'

// biome-ignore lint/suspicious/noExplicitAny: drizzle generic
type AnyDb = any

export const auditRoutes = new Elysia({ prefix: '/audit' })
  .use(authPlugin)
  .use(tenantPlugin)

  .get(
    '/',
    async ({ db, query, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }

      const conditions = []
      if (query.userId) conditions.push(eq(auditLog.userId, query.userId))
      if (query.entity) conditions.push(eq(auditLog.entity, query.entity))
      if (query.action) conditions.push(eq(auditLog.action, query.action))
      if (query.from) conditions.push(gte(auditLog.createdAt, new Date(query.from)))
      if (query.to) conditions.push(lte(auditLog.createdAt, new Date(query.to)))

      const where = conditions.length > 0 ? and(...conditions) : undefined
      const limit = Math.min(500, Math.max(1, Number(query.limit) || 100))
      const offset = Math.max(0, Number(query.offset) || 0)

      const [data, totalResult] = await Promise.all([
        (db as AnyDb)
          .select()
          .from(auditLog)
          .where(where)
          .orderBy(desc(auditLog.createdAt))
          .limit(limit)
          .offset(offset),
        (db as AnyDb).select({ total: sql`COUNT(*)::int` }).from(auditLog).where(where),
      ])

      return { success: true, data, total: Number(totalResult[0]?.total ?? 0) }
    },
    {
      beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('audit:read')],
      query: t.Object({
        userId: t.Optional(t.String()),
        entity: t.Optional(t.String()),
        action: t.Optional(t.String()),
        from: t.Optional(t.String()),
        to: t.Optional(t.String()),
        limit: t.Optional(t.String()),
        offset: t.Optional(t.String()),
      }),
    }
  )
