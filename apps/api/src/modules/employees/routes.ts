import { Elysia, t } from 'elysia'
import { authPlugin, guardAuth, guardRole } from '../../middleware/auth'
import { tenantPlugin } from '../../middleware/tenant'
import {
  createEmployeeService,
  deactivateEmployeeService,
  getEmployeeService,
  listEmployeesService,
  updateEmployeeService,
} from './service'

// ── Shared validation schemas ──────────────────────────────────────────────────

const EmployeeBody = t.Object({
  code: t.String({ minLength: 1, maxLength: 50 }),
  firstName: t.String({ minLength: 1, maxLength: 100 }),
  lastName: t.String({ minLength: 1, maxLength: 100 }),
  idNumber: t.String({ minLength: 1, maxLength: 20 }),
  socialSecurityNumber: t.Optional(t.Nullable(t.String({ maxLength: 20 }))),
  email: t.Optional(t.Nullable(t.String({ format: 'email' }))),
  phone: t.Optional(t.Nullable(t.String({ maxLength: 20 }))),
  cargoId: t.Optional(t.Nullable(t.String())),
  funcionId: t.Optional(t.Nullable(t.String())),
  departamentoId: t.Optional(t.Nullable(t.String())),
  positionId: t.Optional(t.Nullable(t.String())),
  hireDate: t.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' }),
  baseSalary: t.String({ minLength: 1 }),
  payFrequency: t.Optional(
    t.Union([t.Literal('biweekly'), t.Literal('monthly'), t.Literal('weekly')])
  ),
  customFields: t.Optional(t.Record(t.String(), t.Unknown())),
})

const EmployeeUpdateBody = t.Object({
  code: t.Optional(t.String({ minLength: 1, maxLength: 50 })),
  firstName: t.Optional(t.String({ minLength: 1, maxLength: 100 })),
  lastName: t.Optional(t.String({ minLength: 1, maxLength: 100 })),
  idNumber: t.Optional(t.String({ minLength: 1, maxLength: 20 })),
  socialSecurityNumber: t.Optional(t.Nullable(t.String({ maxLength: 20 }))),
  email: t.Optional(t.Nullable(t.String({ format: 'email' }))),
  phone: t.Optional(t.Nullable(t.String({ maxLength: 20 }))),
  cargoId: t.Optional(t.Nullable(t.String())),
  funcionId: t.Optional(t.Nullable(t.String())),
  departamentoId: t.Optional(t.Nullable(t.String())),
  positionId: t.Optional(t.Nullable(t.String())),
  hireDate: t.Optional(t.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' })),
  baseSalary: t.Optional(t.String({ minLength: 1 })),
  payFrequency: t.Optional(
    t.Union([t.Literal('biweekly'), t.Literal('monthly'), t.Literal('weekly')])
  ),
  customFields: t.Optional(t.Record(t.String(), t.Unknown())),
})

const ListQuery = t.Object({
  search: t.Optional(t.String()),
  department: t.Optional(t.String()),
  isActive: t.Optional(t.String()), // 'true' | 'false'
  payFrequency: t.Optional(t.String()),
  page: t.Optional(t.Numeric()),
  limit: t.Optional(t.Numeric()),
  sortOrder: t.Optional(t.Union([t.Literal('asc'), t.Literal('desc')])),
})

/**
 * Employee routes — mounted at /employees
 *
 * GET    /employees           → list (filterable, paginated) — VIEWER+
 * GET    /employees/:id       → get one                      — VIEWER+
 * POST   /employees           → create                       — HR+
 * PUT    /employees/:id       → update                       — HR+
 * DELETE /employees/:id       → deactivate (soft)            — ADMIN+
 */
export const employeeRoutes = new Elysia({ prefix: '/employees' })
  .use(authPlugin)
  .use(tenantPlugin)

  // ── GET /employees ───────────────────────────────────────────────────────────
  .get(
    '/',
    async ({ db, query, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }

      const isActive =
        query.isActive === 'true' ? true : query.isActive === 'false' ? false : undefined

      const result = await listEmployeesService(
        db,
        {
          search: query.search,
          department: query.department,
          isActive,
          payFrequency: query.payFrequency,
        },
        { page: query.page, limit: query.limit, sortOrder: query.sortOrder }
      )
      return { success: true, ...result }
    },
    { beforeHandle: [guardAuth, guardRole('VIEWER')], query: ListQuery }
  )

  // ── GET /employees/:id ───────────────────────────────────────────────────────
  .get(
    '/:id',
    async ({ db, params, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }

      const employee = await getEmployeeService(db, params.id)
      if (!employee) {
        set.status = 404
        return { success: false, error: 'Employee not found' }
      }
      return { success: true, data: employee }
    },
    { beforeHandle: [guardAuth, guardRole('VIEWER')], params: t.Object({ id: t.String() }) }
  )

  // ── POST /employees ──────────────────────────────────────────────────────────
  .post(
    '/',
    async ({ db, body, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }

      try {
        const result = await createEmployeeService(db, body)
        if (!result.success) {
          set.status = result.error === 'code_taken' ? 409 : 400
          return { success: false, error: result.message }
        }
        set.status = 201
        return { success: true, data: result.data }
      } catch (err) {
        const msg = err instanceof Error ? err.message : ''
        if (msg.includes('id_number') || msg.includes('unique')) {
          set.status = 409
          return { success: false, error: 'ID number (cédula) is already registered' }
        }
        throw err
      }
    },
    { beforeHandle: [guardAuth, guardRole('HR')], body: EmployeeBody }
  )

  // ── PUT /employees/:id ───────────────────────────────────────────────────────
  .put(
    '/:id',
    async ({ db, params, body, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }

      try {
        const result = await updateEmployeeService(db, params.id, body)
        if (!result.success) {
          set.status = result.error === 'not_found' ? 404 : 409
          return { success: false, error: result.message }
        }
        return { success: true, data: result.data }
      } catch (err) {
        const msg = err instanceof Error ? err.message : ''
        if (msg.includes('id_number') || msg.includes('unique')) {
          set.status = 409
          return { success: false, error: 'ID number (cédula) is already registered' }
        }
        throw err
      }
    },
    {
      beforeHandle: [guardAuth, guardRole('HR')],
      params: t.Object({ id: t.String() }),
      body: EmployeeUpdateBody,
    }
  )

  // ── DELETE /employees/:id ────────────────────────────────────────────────────
  .delete(
    '/:id',
    async ({ db, params, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }

      const result = await deactivateEmployeeService(db, params.id)
      if (!result.success) {
        set.status = result.error === 'not_found' ? 404 : 400
        return { success: false, error: result.message }
      }
      return { success: true, data: result.data }
    },
    {
      beforeHandle: [guardAuth, guardRole('ADMIN')],
      params: t.Object({ id: t.String() }),
    }
  )
