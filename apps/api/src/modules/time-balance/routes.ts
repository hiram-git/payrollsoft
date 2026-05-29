import { Elysia, t } from 'elysia'
import { authPlugin, guardAuth, guardPermission } from '../../middleware/auth'
import { guardTenantMatchesToken, tenantPlugin } from '../../middleware/tenant'
import {
  type BalanceType,
  creditBalance,
  debitBalance,
  getBalance,
  initializeYearForAllEmployees,
  listBalancesByEmployee,
  listMovements,
} from './service'

export const timeBalanceRoutes = new Elysia({ prefix: '/time-balance' })
  .use(authPlugin)
  .use(tenantPlugin)

  .get(
    '/balances/:employeeId',
    async ({ db, params, query, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const year = query.year ? Number(query.year) : undefined
      const data = await listBalancesByEmployee(db, params.employeeId, year)
      return { success: true, data }
    },
    {
      beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('time_balance:read')],
      params: t.Object({ employeeId: t.String() }),
      query: t.Object({ year: t.Optional(t.String()) }),
    }
  )

  .get(
    '/balance/:employeeId/:type',
    async ({ db, params, query, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const year = query.year ? Number(query.year) : undefined
      const data = await getBalance(db, params.employeeId, params.type as BalanceType, year)
      return { success: true, data }
    },
    {
      beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('time_balance:read')],
      params: t.Object({ employeeId: t.String(), type: t.String() }),
      query: t.Object({ year: t.Optional(t.String()) }),
    }
  )

  .get(
    '/movements/:employeeId',
    async ({ db, params, query, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const data = await listMovements(db, params.employeeId, {
        type: (query.type as BalanceType) || undefined,
        year: query.year ? Number(query.year) : undefined,
        limit: query.limit ? Number(query.limit) : undefined,
      })
      return { success: true, data }
    },
    {
      beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('time_balance:read')],
      params: t.Object({ employeeId: t.String() }),
      query: t.Object({
        type: t.Optional(t.String()),
        year: t.Optional(t.String()),
        limit: t.Optional(t.String()),
      }),
    }
  )

  .post(
    '/adjust',
    async ({ db, body, user, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const type = body.type as BalanceType
      const performedBy = user?.userId

      if (body.minutes > 0) {
        const res = await creditBalance(db, body.employeeId, type, body.minutes, {
          movementType: 'adjustment',
          description: body.description,
          performedBy,
        })
        return { success: true, data: res }
      }

      const res = await debitBalance(db, body.employeeId, type, Math.abs(body.minutes), {
        movementType: 'adjustment',
        allowNegative: body.allowNegative ?? false,
        description: body.description,
        performedBy,
      })
      if (!res.ok) {
        set.status = 422
        return {
          success: false,
          error: 'Saldo insuficiente para este ajuste.',
          data: res,
        }
      }
      return { success: true, data: res }
    },
    {
      beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('time_balance:write')],
      body: t.Object({
        employeeId: t.String(),
        type: t.String(),
        minutes: t.Number(),
        description: t.Optional(t.String()),
        allowNegative: t.Optional(t.Boolean()),
      }),
    }
  )

  .post(
    '/backfill',
    async ({ db, body, user, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const year = body.year ?? new Date().getFullYear()
      const result = await initializeYearForAllEmployees(
        db,
        year,
        user?.userId,
        'system_initialization'
      )
      return { success: true, data: result }
    },
    {
      beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('time_balance:write')],
      body: t.Object({ year: t.Optional(t.Number()) }),
    }
  )
