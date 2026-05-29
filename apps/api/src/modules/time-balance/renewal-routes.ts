import { Elysia, t } from 'elysia'
import { env } from '../../config/env'
import { authPlugin, guardAuth, guardPermission } from '../../middleware/auth'
import { guardTenantMatchesToken, tenantPlugin } from '../../middleware/tenant'
import {
  getRenewalState,
  listRenewalLog,
  runRenewalCycle,
  upsertRenewalState,
} from './renewal-service'
import { isRenewalRunning, startRenewalWorker, stopRenewalWorker } from './renewal-worker'

const GUARD = [guardAuth, guardTenantMatchesToken, guardPermission('time_balance:write')]

export const timeBalanceRenewalRoutes = new Elysia({ prefix: '/time-balance/renewal' })
  .use(authPlugin)
  .use(tenantPlugin)

  .get(
    '/status',
    async ({ db, tenantSlug, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const state = await getRenewalState(db)
      const inMemory = isRenewalRunning(tenantSlug as string)
      return {
        success: true,
        data: { ...(state ?? { status: 'not_configured' }), workerInMemory: inMemory },
      }
    },
    { beforeHandle: GUARD }
  )

  .post(
    '/start',
    async ({ db, body, tenantSlug, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const interval = body?.intervalMinutes ?? 1440
      await upsertRenewalState(db, {
        status: 'running',
        intervalMinutes: interval,
        runMonth: body?.runMonth,
        runDay: body?.runDay,
        autoStart: body?.autoStart,
      })
      startRenewalWorker(tenantSlug as string, interval, env.DATABASE_URL)
      return { success: true, data: await getRenewalState(db) }
    },
    {
      beforeHandle: GUARD,
      body: t.Object({
        intervalMinutes: t.Optional(t.Number({ minimum: 1, maximum: 10080 })),
        runMonth: t.Optional(t.Number({ minimum: 1, maximum: 12 })),
        runDay: t.Optional(t.Number({ minimum: 1, maximum: 31 })),
        autoStart: t.Optional(t.Boolean()),
      }),
    }
  )

  .post(
    '/stop',
    async ({ db, tenantSlug, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      stopRenewalWorker(tenantSlug as string)
      await upsertRenewalState(db, { status: 'stopped' })
      return { success: true, data: await getRenewalState(db) }
    },
    { beforeHandle: GUARD }
  )

  .post(
    '/restart',
    async ({ db, body, tenantSlug, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      stopRenewalWorker(tenantSlug as string)
      const interval = body?.intervalMinutes ?? 1440
      await upsertRenewalState(db, { status: 'running', intervalMinutes: interval })
      startRenewalWorker(tenantSlug as string, interval, env.DATABASE_URL)
      return { success: true, data: await getRenewalState(db) }
    },
    {
      beforeHandle: GUARD,
      body: t.Object({ intervalMinutes: t.Optional(t.Number({ minimum: 1, maximum: 10080 })) }),
    }
  )

  // Manual "run now" — forces a renewal of the current year regardless of the
  // configured date. Idempotent. Restricted to time_balance:write.
  .post(
    '/trigger',
    async ({ db, user, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const result = await runRenewalCycle(db, {
        force: true,
        performedBy: user?.userId,
        trigger: 'manual',
      })
      return { success: true, data: result }
    },
    { beforeHandle: GUARD }
  )

  .get(
    '/log',
    async ({ db, query, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const limit = query?.limit ? Number(query.limit) : 50
      return { success: true, data: await listRenewalLog(db, limit) }
    },
    { beforeHandle: GUARD, query: t.Object({ limit: t.Optional(t.String()) }) }
  )
