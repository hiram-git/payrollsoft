import { Elysia, t } from 'elysia'
import { authPlugin, guardAuth, guardPermission } from '../../middleware/auth'
import { guardTenantMatchesToken, tenantPlugin } from '../../middleware/tenant'
import {
  deleteWorkCalendarYear,
  getShiftsForInitialization,
  initializeWorkCalendar,
  listInitializedYears,
  listWorkCalendar,
} from './service'

/**
 * Calendar routes — mounted at /calendar
 *
 *  GET    /calendar/years                list years that already have rows
 *  GET    /calendar?from=&to=            list calendar entries for a range
 *  POST   /calendar/initialize           generate a year/months from shifts
 *  DELETE /calendar/year/:year           wipe a year
 *
 * Read endpoints require attendance:read; mutating endpoints require
 * settings:company.update so they're admin-only by default.
 */
export const calendarRoutes = new Elysia({ prefix: '/calendar' })
  .use(authPlugin)
  .use(tenantPlugin)

  .get(
    '/years',
    async ({ db, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      return { success: true, data: await listInitializedYears(db) }
    },
    {
      beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('attendance:read')],
    }
  )

  .get(
    '/',
    async ({ db, query, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      return {
        success: true,
        data: await listWorkCalendar(db, { from: query.from, to: query.to }),
      }
    },
    {
      beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('attendance:read')],
      query: t.Object({
        from: t.Optional(t.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' })),
        to: t.Optional(t.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' })),
      }),
    }
  )

  .post(
    '/initialize',
    async ({ db, body, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      try {
        const shifts = await getShiftsForInitialization(db, body.shiftIds)
        if (shifts.length !== body.shiftIds.length) {
          set.status = 400
          return {
            success: false,
            error: 'invalid_shifts',
            message: 'Algunos turnos no existen.',
          }
        }
        if (shifts.some((s) => !s.weekdays || s.weekdays.length === 0)) {
          set.status = 400
          return {
            success: false,
            error: 'shift_without_weekdays',
            message: 'Cada turno debe tener al menos un día seleccionado.',
          }
        }
        const result = await initializeWorkCalendar(db, {
          year: body.year,
          months: body.months,
          shifts,
        })
        return { success: true, data: result }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'unknown'
        set.status = 400
        return { success: false, error: 'invalid_input', message }
      }
    },
    {
      beforeHandle: [
        guardAuth,
        guardTenantMatchesToken,
        guardPermission('settings:company.update'),
      ],
      body: t.Object({
        year: t.Integer({ minimum: 1970, maximum: 2100 }),
        months: t.Optional(t.Array(t.Integer({ minimum: 1, maximum: 12 }), { maxItems: 12 })),
        shiftIds: t.Array(t.String(), { minItems: 1, maxItems: 32 }),
      }),
    }
  )

  .delete(
    '/year/:year',
    async ({ db, params, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const year = Number.parseInt(params.year, 10)
      try {
        const deleted = await deleteWorkCalendarYear(db, year)
        return { success: true, data: { deleted } }
      } catch (err) {
        set.status = 400
        return {
          success: false,
          error: 'invalid_input',
          message: err instanceof Error ? err.message : 'unknown',
        }
      }
    },
    {
      beforeHandle: [
        guardAuth,
        guardTenantMatchesToken,
        guardPermission('settings:company.update'),
      ],
      params: t.Object({ year: t.String() }),
    }
  )
