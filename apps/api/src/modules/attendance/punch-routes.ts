/**
 * POST /attendance/punches — single punch creation endpoint.
 *
 * Supports two authentication modes:
 *
 * 1. Employee JWT (mobile app representing the employee):
 *    - Standard auth cookie or Authorization header
 *    - employeeId in payload MUST match the JWT's userId
 *    - source is derived from the device's connectionMethod or defaults to 'mobile_app'
 *    - The employee can only mark for themselves
 *
 * 2. Device token (shared kiosk/terminal identifying employees via NFC/biometric):
 *    - X-Device-Token header with the token issued at device creation
 *    - The device is trusted to identify the employee (NFC badge, fingerprint, etc.)
 *    - employeeId in payload is trusted — the backend does not restrict it
 *    - source is derived from the device's connectionMethod
 */
import { Elysia, t } from 'elysia'
import { authPlugin } from '../../middleware/auth'
import { guardTenantMatchesToken, tenantPlugin } from '../../middleware/tenant'
import {
  createPunch,
  resolveDeviceByToken,
  sourceForConnection,
  validateEmployeeExists,
} from './punch-service'

export const punchRoutes = new Elysia()
  .use(authPlugin)
  .use(tenantPlugin)

  .post(
    '/attendance/punches',
    async ({ db, user, headers, body, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }

      const deviceToken = headers['x-device-token'] as string | undefined

      // ── Mode 1: Device token auth ──────────────────────────────────────
      if (deviceToken) {
        const device = await resolveDeviceByToken(db, deviceToken)
        if (!device) {
          set.status = 401
          return { success: false, error: 'Invalid device token' }
        }

        const exists = await validateEmployeeExists(db, body.employeeId)
        if (!exists) {
          set.status = 404
          return { success: false, error: 'Empleado no encontrado' }
        }

        const source = sourceForConnection(device.connectionMethod)
        const result = await createPunch(db, {
          employeeId: body.employeeId,
          punchType: body.punchType,
          punchedAt: body.punchedAt,
          deviceId: device.id,
          source,
          idempotencyKey: body.idempotencyKey,
        })

        return { success: true, data: { ...result, authMode: 'device_token', source } }
      }

      // ── Mode 2: Employee JWT auth ──────────────────────────────────────
      if (!user) {
        set.status = 401
        return {
          success: false,
          error: 'Unauthorized: provide auth cookie, Authorization Bearer or X-Device-Token header',
        }
      }

      // El token del portal trae `employeeId` (type='employee'); un token
      // de usuario tenant trae `userId`. En ambos casos el portador solo
      // puede marcar para sí mismo.
      const tokenEmployeeId = user.type === 'employee' ? user.employeeId : user.userId
      if (!tokenEmployeeId || body.employeeId !== tokenEmployeeId) {
        set.status = 403
        return {
          success: false,
          error: 'El JWT del empleado no coincide con el employeeId del payload',
        }
      }

      const source = body.source ?? 'mobile_app'
      const result = await createPunch(db, {
        employeeId: body.employeeId,
        punchType: body.punchType,
        punchedAt: body.punchedAt,
        deviceId: body.deviceId,
        source,
        idempotencyKey: body.idempotencyKey,
      })

      return { success: true, data: { ...result, authMode: 'employee_jwt', source } }
    },
    {
      beforeHandle: [guardTenantMatchesToken],
      body: t.Object({
        employeeId: t.String({ format: 'uuid' }),
        punchType: t.Integer({ minimum: 0, maximum: 9 }),
        punchedAt: t.Optional(t.String()),
        deviceId: t.Optional(t.String({ format: 'uuid' })),
        source: t.Optional(t.String({ maxLength: 20 })),
        idempotencyKey: t.Optional(t.String({ maxLength: 120 })),
      }),
    }
  )
