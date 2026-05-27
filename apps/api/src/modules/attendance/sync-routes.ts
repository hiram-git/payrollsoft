import { Elysia, t } from 'elysia'
import { env } from '../../config/env'
import { authPlugin, guardAuth, guardPermission } from '../../middleware/auth'
import { guardTenantMatchesToken, tenantPlugin } from '../../middleware/tenant'
import {
  getIngestionState,
  listIngestionLog,
  listIngestionStates,
  runIngestionCycle,
  upsertIngestionState,
} from './ingestion-service'
import {
  getConsolidationState,
  listConsolidationLog,
  runConsolidationCycle,
  upsertConsolidationState,
} from './sync-service'
import {
  isConsolidationRunning,
  isIngestionRunning,
  startConsolidationWorker,
  startIngestionWorker,
  stopConsolidationWorker,
  stopIngestionWorker,
} from './sync-worker'

const SYNC_GUARD = [guardAuth, guardTenantMatchesToken, guardPermission('attendance:sync')]

export const syncRoutes = new Elysia()
  .use(authPlugin)
  .use(tenantPlugin)

  // ── Ingestion endpoints ───────────────────────────────────────────────────

  .get(
    '/attendance/ingestion/status',
    async ({ db, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const states = await listIngestionStates(db)
      return { success: true, data: states }
    },
    { beforeHandle: SYNC_GUARD }
  )

  .get(
    '/attendance/ingestion/:deviceId/status',
    async ({ db, params, tenantSlug, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const state = await getIngestionState(db, params.deviceId)
      const inMemory = isIngestionRunning(tenantSlug as string, params.deviceId)
      return {
        success: true,
        data: {
          ...(state ?? { status: 'not_configured', deviceId: params.deviceId }),
          workerInMemory: inMemory,
        },
      }
    },
    { beforeHandle: SYNC_GUARD, params: t.Object({ deviceId: t.String() }) }
  )

  .post(
    '/attendance/ingestion/:deviceId/start',
    async ({ db, params, body, tenantSlug, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const interval = body?.intervalMinutes ?? 5
      await upsertIngestionState(db, params.deviceId, {
        status: 'running',
        intervalMinutes: interval,
        autoStart: body?.autoStart,
      })
      startIngestionWorker(tenantSlug as string, params.deviceId, interval, env.DATABASE_URL)
      return { success: true, data: await getIngestionState(db, params.deviceId) }
    },
    {
      beforeHandle: SYNC_GUARD,
      params: t.Object({ deviceId: t.String() }),
      body: t.Object({
        intervalMinutes: t.Optional(t.Number({ minimum: 1, maximum: 1440 })),
        autoStart: t.Optional(t.Boolean()),
      }),
    }
  )

  .post(
    '/attendance/ingestion/:deviceId/stop',
    async ({ db, params, tenantSlug, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      stopIngestionWorker(tenantSlug as string, params.deviceId)
      await upsertIngestionState(db, params.deviceId, { status: 'stopped' })
      return { success: true, data: await getIngestionState(db, params.deviceId) }
    },
    { beforeHandle: SYNC_GUARD, params: t.Object({ deviceId: t.String() }) }
  )

  .post(
    '/attendance/ingestion/:deviceId/restart',
    async ({ db, params, body, tenantSlug, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      stopIngestionWorker(tenantSlug as string, params.deviceId)
      const interval = body?.intervalMinutes ?? 5
      await upsertIngestionState(db, params.deviceId, {
        status: 'running',
        intervalMinutes: interval,
      })
      startIngestionWorker(tenantSlug as string, params.deviceId, interval, env.DATABASE_URL)
      return { success: true, data: await getIngestionState(db, params.deviceId) }
    },
    {
      beforeHandle: SYNC_GUARD,
      params: t.Object({ deviceId: t.String() }),
      body: t.Object({ intervalMinutes: t.Optional(t.Number({ minimum: 1, maximum: 1440 })) }),
    }
  )

  .post(
    '/attendance/ingestion/:deviceId/trigger',
    async ({ db, params, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const result = await runIngestionCycle(db, params.deviceId)
      return { success: true, data: result }
    },
    { beforeHandle: SYNC_GUARD, params: t.Object({ deviceId: t.String() }) }
  )

  .get(
    '/attendance/ingestion/:deviceId/log',
    async ({ db, params, query, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const limit = query?.limit ? Number(query.limit) : 50
      return { success: true, data: await listIngestionLog(db, params.deviceId, limit) }
    },
    {
      beforeHandle: SYNC_GUARD,
      params: t.Object({ deviceId: t.String() }),
      query: t.Object({ limit: t.Optional(t.String()) }),
    }
  )

  // ── Consolidation endpoints ───────────────────────────────────────────────

  .get(
    '/attendance/consolidation/status',
    async ({ db, tenantSlug, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const state = await getConsolidationState(db)
      const inMemory = isConsolidationRunning(tenantSlug as string)
      return {
        success: true,
        data: { ...(state ?? { status: 'not_configured' }), workerInMemory: inMemory },
      }
    },
    { beforeHandle: SYNC_GUARD }
  )

  .post(
    '/attendance/consolidation/start',
    async ({ db, body, tenantSlug, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const interval = body?.intervalMinutes ?? 15
      await upsertConsolidationState(db, {
        status: 'running',
        intervalMinutes: interval,
        autoStart: body?.autoStart,
      })
      startConsolidationWorker(tenantSlug as string, interval, env.DATABASE_URL)
      return { success: true, data: await getConsolidationState(db) }
    },
    {
      beforeHandle: SYNC_GUARD,
      body: t.Object({
        intervalMinutes: t.Optional(t.Number({ minimum: 1, maximum: 1440 })),
        autoStart: t.Optional(t.Boolean()),
      }),
    }
  )

  .post(
    '/attendance/consolidation/stop',
    async ({ db, tenantSlug, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      stopConsolidationWorker(tenantSlug as string)
      await upsertConsolidationState(db, { status: 'stopped' })
      return { success: true, data: await getConsolidationState(db) }
    },
    { beforeHandle: SYNC_GUARD }
  )

  .post(
    '/attendance/consolidation/restart',
    async ({ db, body, tenantSlug, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      stopConsolidationWorker(tenantSlug as string)
      const interval = body?.intervalMinutes ?? 15
      await upsertConsolidationState(db, { status: 'running', intervalMinutes: interval })
      startConsolidationWorker(tenantSlug as string, interval, env.DATABASE_URL)
      return { success: true, data: await getConsolidationState(db) }
    },
    {
      beforeHandle: SYNC_GUARD,
      body: t.Object({ intervalMinutes: t.Optional(t.Number({ minimum: 1, maximum: 1440 })) }),
    }
  )

  .post(
    '/attendance/consolidation/trigger',
    async ({ db, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const result = await runConsolidationCycle(db)
      return { success: true, data: result }
    },
    { beforeHandle: SYNC_GUARD }
  )

  .get(
    '/attendance/consolidation/log',
    async ({ db, query, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const limit = query?.limit ? Number(query.limit) : 50
      return { success: true, data: await listConsolidationLog(db, limit) }
    },
    { beforeHandle: SYNC_GUARD, query: t.Object({ limit: t.Optional(t.String()) }) }
  )
