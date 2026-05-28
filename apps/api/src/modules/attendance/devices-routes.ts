/**
 * CRUD de dispositivos de marcación.
 *
 *   GET    /attendance/devices              — listar todos
 *   GET    /attendance/devices/:id          — detalle + eventos recientes
 *   POST   /attendance/devices              — crear (devuelve token si es API)
 *   PUT    /attendance/devices/:id          — editar metadata
 *   POST   /attendance/devices/:id/rotate   — rotar token API
 *   POST   /attendance/devices/:id/event    — registrar evento (heartbeat, etc.)
 */
import { Elysia, t } from 'elysia'
import { authPlugin, guardAuth, guardPermission } from '../../middleware/auth'
import { guardTenantMatchesToken, tenantPlugin } from '../../middleware/tenant'
import {
  createDevice,
  getDevice,
  listDeviceEvents,
  listDevices,
  recordDeviceEvent,
  rotateDeviceToken,
  updateDevice,
} from './devices-service'

export const attendanceDevicesRoutes = new Elysia({ prefix: '/attendance/devices' })
  .use(authPlugin)
  .use(tenantPlugin)

  .get(
    '/',
    async ({ db, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const data = await listDevices(db)
      return { success: true, data }
    },
    { beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('terminals:read')] }
  )

  .get(
    '/:id',
    async ({ db, params, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const device = await getDevice(db, params.id)
      if (!device) {
        set.status = 404
        return { success: false, error: 'Dispositivo no encontrado' }
      }
      const events = await listDeviceEvents(db, params.id, 20)
      return { success: true, data: { device, events } }
    },
    {
      beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('terminals:read')],
      params: t.Object({ id: t.String() }),
    }
  )

  .post(
    '/',
    async ({ db, body, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      try {
        const result = await createDevice(db, body)
        set.status = 201
        return { success: true, data: result }
      } catch (err) {
        set.status = 422
        return {
          success: false,
          error: err instanceof Error ? err.message : 'No se pudo crear el dispositivo',
        }
      }
    },
    {
      beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('terminals:write')],
      body: t.Object({
        code: t.String({ minLength: 1, maxLength: 60 }),
        name: t.String({ minLength: 1, maxLength: 160 }),
        deviceType: t.Union([
          t.Literal('biometric_clock'),
          t.Literal('facial_kiosk'),
          t.Literal('tablet'),
          t.Literal('nfc_reader'),
          t.Literal('turnstile'),
          t.Literal('other'),
        ]),
        connectionMethod: t.Union([
          t.Literal('txt_import'),
          t.Literal('api'),
          t.Literal('sdk'),
          t.Literal('webhook'),
          t.Literal('manual'),
          t.Literal('mobile_app'),
        ]),
        location: t.Optional(t.Nullable(t.String({ maxLength: 200 }))),
        ipAddress: t.Optional(t.Nullable(t.String({ maxLength: 45 }))),
        latitude: t.Optional(t.Nullable(t.String({ maxLength: 20 }))),
        longitude: t.Optional(t.Nullable(t.String({ maxLength: 20 }))),
        serialNumber: t.Optional(t.Nullable(t.String({ maxLength: 100 }))),
        manufacturer: t.Optional(t.Nullable(t.String({ maxLength: 100 }))),
        model: t.Optional(t.Nullable(t.String({ maxLength: 100 }))),
        syncSourcePath: t.Optional(t.Nullable(t.String({ maxLength: 500 }))),
      }),
    }
  )

  .put(
    '/:id',
    async ({ db, params, body, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const row = await updateDevice(db, params.id, body)
      if (!row) {
        set.status = 404
        return { success: false, error: 'Dispositivo no encontrado' }
      }
      return { success: true, data: row }
    },
    {
      beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('terminals:write')],
      params: t.Object({ id: t.String() }),
      body: t.Object({
        name: t.Optional(t.String({ minLength: 1, maxLength: 160 })),
        location: t.Optional(t.Nullable(t.String({ maxLength: 200 }))),
        ipAddress: t.Optional(t.Nullable(t.String({ maxLength: 45 }))),
        latitude: t.Optional(t.Nullable(t.String({ maxLength: 20 }))),
        longitude: t.Optional(t.Nullable(t.String({ maxLength: 20 }))),
        serialNumber: t.Optional(t.Nullable(t.String({ maxLength: 100 }))),
        manufacturer: t.Optional(t.Nullable(t.String({ maxLength: 100 }))),
        model: t.Optional(t.Nullable(t.String({ maxLength: 100 }))),
        syncSourcePath: t.Optional(t.Nullable(t.String({ maxLength: 500 }))),
        status: t.Optional(
          t.Union([t.Literal('active'), t.Literal('inactive'), t.Literal('maintenance')])
        ),
        isActive: t.Optional(t.Integer({ minimum: 0, maximum: 1 })),
      }),
    }
  )

  .post(
    '/:id/rotate',
    async ({ db, params, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const result = await rotateDeviceToken(db, params.id)
      if (!result) {
        set.status = 404
        return { success: false, error: 'Dispositivo no encontrado' }
      }
      return { success: true, data: result }
    },
    {
      beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('terminals:write')],
      params: t.Object({ id: t.String() }),
    }
  )

  .post(
    '/:id/event',
    async ({ db, params, body, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      await recordDeviceEvent(db, params.id, body.kind, body.message ?? undefined)
      return { success: true }
    },
    {
      beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('terminals:write')],
      params: t.Object({ id: t.String() }),
      body: t.Object({
        kind: t.String({ minLength: 1, maxLength: 40 }),
        message: t.Optional(t.Nullable(t.String({ maxLength: 500 }))),
      }),
    }
  )
