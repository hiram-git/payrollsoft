import { Elysia, t } from 'elysia'
import { env } from '../../config/env'
import { authPlugin, guardAuth, guardPermission } from '../../middleware/auth'
import { guardTenantMatchesToken, tenantPlugin } from '../../middleware/tenant'
import {
  getSyncState,
  listSyncLog,
  listSyncStates,
  runSyncCycle,
  upsertSyncState,
} from './sync-service'
import { isWorkerRunning, startDeviceWorker, stopDeviceWorker } from './sync-worker'

export const syncRoutes = new Elysia()
  .use(authPlugin)
  .use(tenantPlugin)

  .get(
    '/attendance/sync/status',
    async ({ db, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const states = await listSyncStates(db)
      return { success: true, data: states }
    },
    {
      beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('attendance:sync')],
    }
  )

  .get(
    '/attendance/sync/:deviceId/status',
    async ({ db, params, tenantSlug, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const state = await getSyncState(db, params.deviceId)
      const slug = tenantSlug as string
      const inMemory = isWorkerRunning(slug, params.deviceId)
      return {
        success: true,
        data: {
          ...(state ?? { status: 'not_configured', deviceId: params.deviceId }),
          workerInMemory: inMemory,
        },
      }
    },
    {
      beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('attendance:sync')],
      params: t.Object({ deviceId: t.String() }),
    }
  )

  .post(
    '/attendance/sync/:deviceId/start',
    async ({ db, params, body, tenantSlug, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const intervalMinutes = body?.intervalMinutes ?? 15

      await upsertSyncState(db, params.deviceId, {
        status: 'running',
        intervalMinutes,
        autoStart: body?.autoStart,
      })

      startDeviceWorker(tenantSlug as string, params.deviceId, intervalMinutes, env.DATABASE_URL)

      const state = await getSyncState(db, params.deviceId)
      return { success: true, data: state }
    },
    {
      beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('attendance:sync')],
      params: t.Object({ deviceId: t.String() }),
      body: t.Object({
        intervalMinutes: t.Optional(t.Number({ minimum: 1, maximum: 1440 })),
        autoStart: t.Optional(t.Boolean()),
      }),
    }
  )

  .post(
    '/attendance/sync/:deviceId/stop',
    async ({ db, params, tenantSlug, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }

      stopDeviceWorker(tenantSlug as string, params.deviceId)
      await upsertSyncState(db, params.deviceId, { status: 'stopped' })

      const state = await getSyncState(db, params.deviceId)
      return { success: true, data: state }
    },
    {
      beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('attendance:sync')],
      params: t.Object({ deviceId: t.String() }),
    }
  )

  .post(
    '/attendance/sync/:deviceId/restart',
    async ({ db, params, body, tenantSlug, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }

      stopDeviceWorker(tenantSlug as string, params.deviceId)

      const intervalMinutes = body?.intervalMinutes ?? 15
      await upsertSyncState(db, params.deviceId, {
        status: 'running',
        intervalMinutes,
      })

      startDeviceWorker(tenantSlug as string, params.deviceId, intervalMinutes, env.DATABASE_URL)

      const state = await getSyncState(db, params.deviceId)
      return { success: true, data: state }
    },
    {
      beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('attendance:sync')],
      params: t.Object({ deviceId: t.String() }),
      body: t.Object({
        intervalMinutes: t.Optional(t.Number({ minimum: 1, maximum: 1440 })),
      }),
    }
  )

  .post(
    '/attendance/sync/:deviceId/trigger',
    async ({ db, params, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }

      const result = await runSyncCycle(db, params.deviceId)
      return { success: true, data: result }
    },
    {
      beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('attendance:sync')],
      params: t.Object({ deviceId: t.String() }),
    }
  )

  .get(
    '/attendance/sync/:deviceId/log',
    async ({ db, params, query, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const limit = query?.limit ? Number(query.limit) : 50
      const log = await listSyncLog(db, params.deviceId, limit)
      return { success: true, data: log }
    },
    {
      beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('attendance:sync')],
      params: t.Object({ deviceId: t.String() }),
      query: t.Object({ limit: t.Optional(t.String()) }),
    }
  )
