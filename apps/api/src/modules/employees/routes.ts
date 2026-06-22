import { Elysia, t } from 'elysia'
import { authPlugin, guardAuth, guardPermission } from '../../middleware/auth'
import { tenantPlugin } from '../../middleware/tenant'
import {
  createEmployeeService,
  deactivateEmployeeService,
  getEmployeeService,
  listCustomFieldHistoryService,
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
  sex: t.Optional(t.Nullable(t.String({ maxLength: 10 }))),
  nationality: t.Optional(t.Nullable(t.String({ maxLength: 30 }))),
  email: t.Optional(t.Nullable(t.String({ format: 'email' }))),
  phone: t.Optional(t.Nullable(t.String({ maxLength: 20 }))),
  jobTitleId: t.Optional(t.Nullable(t.String())),
  jobFunctionId: t.Optional(t.Nullable(t.String())),
  departmentId: t.Optional(t.Nullable(t.String())),
  positionId: t.Optional(t.Nullable(t.String())),
  hireDate: t.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' }),
  baseSalary: t.String({ minLength: 1 }),
  payFrequency: t.Optional(
    t.Union([t.Literal('biweekly'), t.Literal('monthly'), t.Literal('weekly')])
  ),
  contractType: t.Optional(t.Nullable(t.String({ maxLength: 40 }))),
  contractEndDate: t.Optional(t.Nullable(t.String())),
  payrollTypeIds: t.Optional(t.Array(t.String())),
  customFields: t.Optional(t.Record(t.String(), t.Unknown())),
  // Personal flags + media (Phase 2.D)
  hasOwnDisability: t.Optional(t.Boolean()),
  requiresAttendanceMarking: t.Optional(t.Boolean()),
  canRead: t.Optional(t.Boolean()),
  canWrite: t.Optional(t.Boolean()),
  photo: t.Optional(t.Nullable(t.String())),
  scannedId: t.Optional(t.Nullable(t.String())),
  // Datos bancarios (tesorería)
  bankId: t.Optional(t.Nullable(t.String())),
  accountNumber: t.Optional(t.Nullable(t.String({ maxLength: 40 }))),
  accountType: t.Optional(t.Nullable(t.Union([t.Literal('savings'), t.Literal('checking')]))),
  paymentMethod: t.Optional(t.Union([t.Literal('ach'), t.Literal('check'), t.Literal('cash')])),
})

const EmployeeUpdateBody = t.Object({
  code: t.Optional(t.String({ minLength: 1, maxLength: 50 })),
  firstName: t.Optional(t.String({ minLength: 1, maxLength: 100 })),
  secondName: t.Optional(t.Nullable(t.String({ maxLength: 100 }))),
  lastName: t.Optional(t.String({ minLength: 1, maxLength: 100 })),
  secondSurname: t.Optional(t.Nullable(t.String({ maxLength: 100 }))),
  marriedSurname: t.Optional(t.Nullable(t.String({ maxLength: 100 }))),
  idNumber: t.Optional(t.String({ minLength: 1, maxLength: 20 })),
  idPrefix: t.Optional(t.Nullable(t.String({ maxLength: 5 }))),
  idProvince: t.Optional(t.Nullable(t.String({ maxLength: 5 }))),
  idVolume: t.Optional(t.Nullable(t.String({ maxLength: 10 }))),
  idFolio: t.Optional(t.Nullable(t.String({ maxLength: 10 }))),
  socialSecurityNumber: t.Optional(t.Nullable(t.String({ maxLength: 20 }))),
  sex: t.Optional(t.Nullable(t.String({ maxLength: 10 }))),
  maritalStatus: t.Optional(t.Nullable(t.String({ maxLength: 20 }))),
  nationality: t.Optional(t.Nullable(t.String({ maxLength: 30 }))),
  birthDate: t.Optional(t.Nullable(t.String())),
  birthPlace: t.Optional(t.Nullable(t.String({ maxLength: 255 }))),
  email: t.Optional(t.Nullable(t.String({ format: 'email' }))),
  personalEmail: t.Optional(t.Nullable(t.String({ maxLength: 255 }))),
  phone: t.Optional(t.Nullable(t.String({ maxLength: 20 }))),
  addressProvince: t.Optional(t.Nullable(t.String({ maxLength: 100 }))),
  addressDistrict: t.Optional(t.Nullable(t.String({ maxLength: 100 }))),
  addressTownship: t.Optional(t.Nullable(t.String({ maxLength: 100 }))),
  address: t.Optional(t.Nullable(t.String({ maxLength: 500 }))),
  otherAddress: t.Optional(t.Nullable(t.String({ maxLength: 500 }))),
  jobTitleId: t.Optional(t.Nullable(t.String())),
  jobFunctionId: t.Optional(t.Nullable(t.String())),
  departmentId: t.Optional(t.Nullable(t.String())),
  positionId: t.Optional(t.Nullable(t.String())),
  hireDate: t.Optional(t.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' })),
  baseSalary: t.Optional(t.String({ minLength: 1 })),
  payFrequency: t.Optional(
    t.Union([t.Literal('biweekly'), t.Literal('monthly'), t.Literal('weekly')])
  ),
  decreeNumber: t.Optional(t.Nullable(t.String({ maxLength: 50 }))),
  resolutionNumber: t.Optional(t.Nullable(t.String({ maxLength: 50 }))),
  decreeDate: t.Optional(t.Nullable(t.String())),
  resolutionDate: t.Optional(t.Nullable(t.String())),
  collaboratorNumber: t.Optional(t.Nullable(t.String({ maxLength: 20 }))),
  externalUserRef: t.Optional(t.Nullable(t.String({ maxLength: 100 }))),
  contractType: t.Optional(t.Nullable(t.String({ maxLength: 40 }))),
  contractEndDate: t.Optional(t.Nullable(t.String())),
  irKey: t.Optional(t.Nullable(t.String({ maxLength: 20 }))),
  shiftId: t.Optional(t.Nullable(t.String())),
  weeklyBaseHours: t.Optional(t.Nullable(t.String({ maxLength: 10 }))),
  observations: t.Optional(t.Nullable(t.String())),
  terminationDecree: t.Optional(t.Nullable(t.String({ maxLength: 50 }))),
  terminationResolution: t.Optional(t.Nullable(t.String({ maxLength: 50 }))),
  terminationDecreeDate: t.Optional(t.Nullable(t.String())),
  terminationResolutionDate: t.Optional(t.Nullable(t.String())),
  terminationReason: t.Optional(t.Nullable(t.String({ maxLength: 255 }))),
  siacapPct: t.Optional(t.Nullable(t.String({ maxLength: 10 }))),
  payrollTypeIds: t.Optional(t.Array(t.String())),
  customFields: t.Optional(t.Record(t.String(), t.Unknown())),
  // Personal flags + media (Phase 2.D)
  hasOwnDisability: t.Optional(t.Boolean()),
  requiresAttendanceMarking: t.Optional(t.Boolean()),
  canRead: t.Optional(t.Boolean()),
  canWrite: t.Optional(t.Boolean()),
  photo: t.Optional(t.Nullable(t.String())),
  scannedId: t.Optional(t.Nullable(t.String())),
  bankId: t.Optional(t.Nullable(t.String())),
  accountNumber: t.Optional(t.Nullable(t.String({ maxLength: 40 }))),
  accountType: t.Optional(t.Nullable(t.Union([t.Literal('savings'), t.Literal('checking')]))),
  paymentMethod: t.Optional(t.Union([t.Literal('ach'), t.Literal('check'), t.Literal('cash')])),
})

const ListQuery = t.Object({
  search: t.Optional(t.String()),
  department: t.Optional(t.String()),
  isActive: t.Optional(t.String()), // 'true' | 'false'
  payFrequency: t.Optional(t.String()),
  payrollTypeId: t.Optional(t.String()),
  hasOwnDisability: t.Optional(t.String()), // 'true' | 'false'
  hasFamilyDisability: t.Optional(t.String()), // 'true'
  page: t.Optional(t.Numeric()),
  limit: t.Optional(t.Numeric()),
  sortOrder: t.Optional(t.Union([t.Literal('asc'), t.Literal('desc')])),
})

/**
 * Employee routes — mounted at /employees
 *
 * GET    /employees           → list (filterable, paginated)  — employees:read
 * GET    /employees/:id       → get one                       — employees:read
 * POST   /employees           → create                        — employees:create
 * PUT    /employees/:id       → update                        — employees:update
 * DELETE /employees/:id       → deactivate (soft)             — employees:delete
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
      const hasOwnDisability =
        query.hasOwnDisability === 'true'
          ? true
          : query.hasOwnDisability === 'false'
            ? false
            : undefined

      const result = await listEmployeesService(
        db,
        {
          search: query.search,
          department: query.department,
          isActive,
          payFrequency: query.payFrequency,
          payrollTypeId: query.payrollTypeId,
          hasOwnDisability,
          hasFamilyDisability: query.hasFamilyDisability === 'true' ? true : undefined,
        },
        { page: query.page, limit: query.limit, sortOrder: query.sortOrder }
      )
      return { success: true, ...result }
    },
    { beforeHandle: [guardAuth, guardPermission('employees:read')], query: ListQuery }
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
    {
      beforeHandle: [guardAuth, guardPermission('employees:read')],
      params: t.Object({ id: t.String() }),
    }
  )

  // ── POST /employees ──────────────────────────────────────────────────────────
  .post(
    '/',
    async ({ db, body, user, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }

      try {
        const result = await createEmployeeService(db, body, {
          userPermissions: new Set(user?.permissions ?? []),
          isSuperAdmin: user?.type === 'super_admin',
        })
        if (!result.success) {
          set.status =
            result.error === 'code_taken'
              ? 409
              : result.error === 'custom_field_required' ||
                  result.error === 'salary_exceeds_position' ||
                  result.error === 'invalid_image'
                ? 422
                : result.error === 'custom_field_forbidden'
                  ? 403
                  : 400
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
    { beforeHandle: [guardAuth, guardPermission('employees:create')], body: EmployeeBody }
  )

  // ── PUT /employees/:id ───────────────────────────────────────────────────────
  .put(
    '/:id',
    async ({ db, params, body, user, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }

      try {
        const result = await updateEmployeeService(db, params.id, body, {
          changedBy: user?.userId,
          userPermissions: new Set(user?.permissions ?? []),
          isSuperAdmin: user?.type === 'super_admin',
        })
        if (!result.success) {
          set.status =
            result.error === 'not_found'
              ? 404
              : result.error === 'custom_field_required' ||
                  result.error === 'salary_exceeds_position' ||
                  result.error === 'invalid_image'
                ? 422
                : result.error === 'custom_field_forbidden'
                  ? 403
                  : 409
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
      beforeHandle: [guardAuth, guardPermission('employees:update')],
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
      beforeHandle: [guardAuth, guardPermission('employees:delete')],
      params: t.Object({ id: t.String() }),
    }
  )

  // GET /employees/:id/custom-fields/history — historial de cambios
  // de campos adicionales para el empleado, del más reciente al más
  // antiguo. Solo lectura; el writer es el PUT del propio empleado.
  .get(
    '/:id/custom-fields/history',
    async ({ db, params, query, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const limit = query.limit ? Number.parseInt(query.limit, 10) : undefined
      const data = await listCustomFieldHistoryService(
        db,
        params.id,
        Number.isFinite(limit) ? limit : 100
      )
      return { success: true, data }
    },
    {
      beforeHandle: [guardAuth, guardPermission('employees:read')],
      params: t.Object({ id: t.String() }),
      query: t.Object({ limit: t.Optional(t.String()) }),
    }
  )
