import { Elysia, t } from 'elysia'
import { authPlugin, guardAuth, guardPermission } from '../../middleware/auth'
import { tenantPlugin } from '../../middleware/tenant'
import {
  addHours,
  deductHours,
  getBalance,
  initializeEmployeeBalances,
  initializeYearForAllEmployees,
  listMovements,
} from './service'
import type { PoolType } from './service'

export const compensatoryTimeRoutes = new Elysia({ prefix: '/compensatory-time' })
  .use(authPlugin)
  .use(tenantPlugin)

  .get(
    '/balance/:employeeId',
    async ({ params, store }) => {
      guardAuth(store)
      // biome-ignore lint/suspicious/noExplicitAny: Elysia store
      const db = (store as any).tenantDb
      const balances = await getBalance(db, params.employeeId)
      return { success: true, data: balances }
    },
    { params: t.Object({ employeeId: t.String() }) }
  )

  .get(
    '/movements/:employeeId',
    async ({ params, query, store }) => {
      guardAuth(store)
      // biome-ignore lint/suspicious/noExplicitAny: Elysia store
      const db = (store as any).tenantDb
      const movements = await listMovements(db, params.employeeId, {
        pool: (query.pool as PoolType) || undefined,
        limit: query.limit ? Number(query.limit) : undefined,
      })
      return { success: true, data: movements }
    },
    {
      params: t.Object({ employeeId: t.String() }),
      query: t.Object({
        pool: t.Optional(t.String()),
        limit: t.Optional(t.String()),
      }),
    }
  )

  .post(
    '/initialize',
    async ({ body, store }) => {
      guardAuth(store)
      guardPermission(store, 'employees:write')
      // biome-ignore lint/suspicious/noExplicitAny: Elysia store
      const db = (store as any).tenantDb
      // biome-ignore lint/suspicious/noExplicitAny: Elysia store
      const user = (store as any).user

      const results = await initializeEmployeeBalances(db, body.employeeId, {
        hasDisability: body.hasDisability,
        hasFamilyDisability: body.hasFamilyDisability,
        year: body.year,
        performedBy: user?.id,
      })
      return { success: true, data: results }
    },
    {
      body: t.Object({
        employeeId: t.String(),
        hasDisability: t.Optional(t.Boolean()),
        hasFamilyDisability: t.Optional(t.Boolean()),
        year: t.Optional(t.Number()),
      }),
    }
  )

  .post(
    '/initialize-year',
    async ({ body, store }) => {
      guardAuth(store)
      guardPermission(store, 'employees:write')
      // biome-ignore lint/suspicious/noExplicitAny: Elysia store
      const db = (store as any).tenantDb
      // biome-ignore lint/suspicious/noExplicitAny: Elysia store
      const user = (store as any).user
      const year = body.year ?? new Date().getFullYear()
      const result = await initializeYearForAllEmployees(db, year, user?.id)
      return { success: true, data: result }
    },
    {
      body: t.Object({
        year: t.Optional(t.Number()),
      }),
    }
  )

  .post(
    '/adjust',
    async ({ body, store }) => {
      guardAuth(store)
      guardPermission(store, 'employees:write')
      // biome-ignore lint/suspicious/noExplicitAny: Elysia store
      const db = (store as any).tenantDb
      // biome-ignore lint/suspicious/noExplicitAny: Elysia store
      const user = (store as any).user

      const pool = body.pool as PoolType
      const result =
        body.hours > 0
          ? await addHours(db, body.employeeId, pool, body.hours, 'adjustment', {
              notes: body.notes,
              performedBy: user?.id,
            })
          : await deductHours(db, body.employeeId, pool, Math.abs(body.hours), 'adjustment', {
              notes: body.notes,
              performedBy: user?.id,
            })
      return { success: true, data: result }
    },
    {
      body: t.Object({
        employeeId: t.String(),
        pool: t.String(),
        hours: t.Number(),
        notes: t.Optional(t.String()),
      }),
    }
  )
