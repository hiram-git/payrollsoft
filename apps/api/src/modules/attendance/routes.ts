import { Elysia, t } from 'elysia'
import { authPlugin, guardAuth, guardRole } from '../../middleware/auth'
import { tenantPlugin } from '../../middleware/tenant'
import {
  createShiftService,
  deleteAttendanceService,
  deleteShiftService,
  getAttendanceService,
  getShiftService,
  listAttendanceService,
  listShiftsService,
  updateAttendanceService,
  updateShiftService,
  upsertAttendanceService,
} from './service'

// ── Shared validation schemas ──────────────────────────────────────────────────

const ShiftBody = t.Object({
  name: t.String(),
  entryTime: t.String(),
  lunchStartTime: t.Optional(t.Nullable(t.String())),
  lunchEndTime: t.Optional(t.Nullable(t.String())),
  exitTime: t.String(),
  entryToleranceBefore: t.Optional(t.Number()),
  entryToleranceAfter: t.Optional(t.Number()),
  lunchStartToleranceBefore: t.Optional(t.Number()),
  lunchStartToleranceAfter: t.Optional(t.Number()),
  lunchEndToleranceBefore: t.Optional(t.Number()),
  lunchEndToleranceAfter: t.Optional(t.Number()),
  exitToleranceBefore: t.Optional(t.Number()),
  exitToleranceAfter: t.Optional(t.Number()),
  isDefault: t.Optional(t.Boolean()),
})

const AttendanceBody = t.Object({
  employeeId: t.String(),
  date: t.String(),
  checkIn: t.Optional(t.Nullable(t.String())),
  lunchStart: t.Optional(t.Nullable(t.String())),
  lunchEnd: t.Optional(t.Nullable(t.String())),
  checkOut: t.Optional(t.Nullable(t.String())),
})

const AttendanceListQuery = t.Object({
  date: t.Optional(t.String()),
  employeeId: t.Optional(t.String()),
  from: t.Optional(t.String()),
  to: t.Optional(t.String()),
})

/**
 * Attendance routes — mounted at /attendance
 *
 * GET    /attendance/shifts         → list shifts           — VIEWER+
 * GET    /attendance/shifts/:id     → get shift             — VIEWER+
 * POST   /attendance/shifts         → create shift          — HR+
 * PUT    /attendance/shifts/:id     → update shift          — HR+
 * DELETE /attendance/shifts/:id     → delete shift          — ADMIN+
 *
 * GET    /attendance               → list records           — VIEWER+
 * GET    /attendance/:id           → get record             — VIEWER+
 * POST   /attendance               → upsert record          — HR+
 * DELETE /attendance/:id           → delete record          — ADMIN+
 */
export const attendanceRoutes = new Elysia({ prefix: '/attendance' })
  .use(authPlugin)
  .use(tenantPlugin)

  // ── GET /attendance/shifts ───────────────────────────────────────────────────
  .get(
    '/shifts',
    async ({ db, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const data = await listShiftsService(db)
      return { success: true, data }
    },
    { beforeHandle: [guardAuth, guardRole('VIEWER')] }
  )

  // ── GET /attendance/shifts/:id ───────────────────────────────────────────────
  .get(
    '/shifts/:id',
    async ({ db, params, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const result = await getShiftService(db, params.id)
      if (!result.success) {
        set.status = result.error === 'not_found' ? 404 : 400
        return { success: false, error: result.message }
      }
      return { success: true, data: result.data }
    },
    {
      beforeHandle: [guardAuth, guardRole('VIEWER')],
      params: t.Object({ id: t.String() }),
    }
  )

  // ── POST /attendance/shifts ──────────────────────────────────────────────────
  .post(
    '/shifts',
    async ({ db, body, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const result = await createShiftService(db, body)
      if (!result.success) {
        set.status = result.error === 'not_found' ? 404 : 400
        return { success: false, error: result.message }
      }
      set.status = 201
      return { success: true, data: result.data }
    },
    { beforeHandle: [guardAuth, guardRole('HR')], body: ShiftBody }
  )

  // ── PUT /attendance/shifts/:id ───────────────────────────────────────────────
  .put(
    '/shifts/:id',
    async ({ db, params, body, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const result = await updateShiftService(db, params.id, body)
      if (!result.success) {
        set.status = result.error === 'not_found' ? 404 : 400
        return { success: false, error: result.message }
      }
      return { success: true, data: result.data }
    },
    {
      beforeHandle: [guardAuth, guardRole('HR')],
      params: t.Object({ id: t.String() }),
      body: t.Partial(ShiftBody),
    }
  )

  // ── DELETE /attendance/shifts/:id ────────────────────────────────────────────
  .delete(
    '/shifts/:id',
    async ({ db, params, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const result = await deleteShiftService(db, params.id)
      if (!result.success) {
        set.status = result.error === 'not_found' ? 404 : 400
        return { success: false, error: result.message }
      }
      return { success: true }
    },
    {
      beforeHandle: [guardAuth, guardRole('ADMIN')],
      params: t.Object({ id: t.String() }),
    }
  )

  // ── GET /attendance ──────────────────────────────────────────────────────────
  .get(
    '/',
    async ({ db, query, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const data = await listAttendanceService(db, {
        date: query.date,
        employeeId: query.employeeId,
        from: query.from,
        to: query.to,
      })
      return { success: true, data }
    },
    { beforeHandle: [guardAuth, guardRole('VIEWER')], query: AttendanceListQuery }
  )

  // ── GET /attendance/:id ──────────────────────────────────────────────────────
  .get(
    '/:id',
    async ({ db, params, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const result = await getAttendanceService(db, params.id)
      if (!result.success) {
        set.status = result.error === 'not_found' ? 404 : 400
        return { success: false, error: result.message }
      }
      return { success: true, data: result.data }
    },
    {
      beforeHandle: [guardAuth, guardRole('VIEWER')],
      params: t.Object({ id: t.String() }),
    }
  )

  // ── POST /attendance ─────────────────────────────────────────────────────────
  .post(
    '/',
    async ({ db, body, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const result = await upsertAttendanceService(db, body)
      if (!result.success) {
        set.status = result.error === 'not_found' ? 404 : 400
        return { success: false, error: result.message }
      }
      return { success: true, data: result.data }
    },
    { beforeHandle: [guardAuth, guardRole('HR')], body: AttendanceBody }
  )

  // ── PUT /attendance/:id ──────────────────────────────────────────────────────
  .put(
    '/:id',
    async ({ db, params, body, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const result = await updateAttendanceService(db, params.id, body)
      if (!result.success) {
        set.status = result.error === 'not_found' ? 404 : 400
        return { success: false, error: result.message }
      }
      return { success: true, data: result.data }
    },
    {
      beforeHandle: [guardAuth, guardRole('HR')],
      params: t.Object({ id: t.String() }),
      body: t.Object({
        checkIn: t.Optional(t.Nullable(t.String())),
        lunchStart: t.Optional(t.Nullable(t.String())),
        lunchEnd: t.Optional(t.Nullable(t.String())),
        checkOut: t.Optional(t.Nullable(t.String())),
      }),
    }
  )

  // ── DELETE /attendance/:id ───────────────────────────────────────────────────
  .delete(
    '/:id',
    async ({ db, params, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const result = await deleteAttendanceService(db, params.id)
      if (!result.success) {
        set.status = result.error === 'not_found' ? 404 : 400
        return { success: false, error: result.message }
      }
      return { success: true }
    },
    {
      beforeHandle: [guardAuth, guardRole('ADMIN')],
      params: t.Object({ id: t.String() }),
    }
  )
