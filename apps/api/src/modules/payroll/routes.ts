import { Elysia, t } from 'elysia'
import { authPlugin, guardAuth, guardRole } from '../../middleware/auth'
import { tenantPlugin } from '../../middleware/tenant'
import {
  closePayrollService,
  createPayrollService,
  deletePayrollService,
  generatePayrollService,
  getPayrollService,
  listPayrollsService,
  regeneratePayrollService,
  reopenPayrollService,
  updatePayrollService,
} from './service'

const PayrollBody = t.Object({
  name: t.String({ minLength: 1, maxLength: 255 }),
  type: t.String({ minLength: 1 }),
  frequency: t.String({ minLength: 1 }),
  periodStart: t.String({ minLength: 1 }),
  periodEnd: t.String({ minLength: 1 }),
  paymentDate: t.Optional(t.Nullable(t.String())),
})

const PayrollUpdateBody = t.Object({
  name: t.Optional(t.String({ minLength: 1, maxLength: 255 })),
  paymentDate: t.Optional(t.Nullable(t.String())),
})

export const payrollRoutes = new Elysia({ prefix: '/payroll' })
  .use(authPlugin)
  .use(tenantPlugin)

  .get(
    '/',
    async ({ db, query, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const data = await listPayrollsService(db, {
        status: query.status,
        type: query.type,
        year: query.year ? Number(query.year) : undefined,
      })
      return { success: true, ...data }
    },
    {
      beforeHandle: [guardAuth, guardRole('VIEWER')],
      query: t.Object({
        status: t.Optional(t.String()),
        type: t.Optional(t.String()),
        year: t.Optional(t.String()),
      }),
    }
  )

  .get(
    '/:id',
    async ({ db, params, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const data = await getPayrollService(db, params.id)
      if (!data) {
        set.status = 404
        return { success: false, error: 'Payroll not found' }
      }
      return { success: true, data }
    },
    { beforeHandle: [guardAuth, guardRole('VIEWER')], params: t.Object({ id: t.String() }) }
  )

  .post(
    '/',
    async ({ db, body, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const result = await createPayrollService(db, body)
      if (!result.success) {
        set.status = 400
        return { success: false, error: result.message }
      }
      set.status = 201
      return { success: true, data: result.data }
    },
    { beforeHandle: [guardAuth, guardRole('HR')], body: PayrollBody }
  )

  .put(
    '/:id',
    async ({ db, params, body, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const result = await updatePayrollService(db, params.id, body)
      if (!result.success) {
        set.status = result.error === 'not_found' ? 404 : 400
        return { success: false, error: result.message }
      }
      return { success: true, data: result.data }
    },
    {
      beforeHandle: [guardAuth, guardRole('HR')],
      params: t.Object({ id: t.String() }),
      body: PayrollUpdateBody,
    }
  )

  .delete(
    '/:id',
    async ({ db, params, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const result = await deletePayrollService(db, params.id)
      if (!result.success) {
        set.status = result.error === 'not_found' ? 404 : 400
        return { success: false, error: result.message }
      }
      return { success: true }
    },
    { beforeHandle: [guardAuth, guardRole('ADMIN')], params: t.Object({ id: t.String() }) }
  )

  // POST /payroll/:id/generate — created → generated
  .post(
    '/:id/generate',
    async ({ db, params, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const result = await generatePayrollService(db, params.id)
      if (!result.success) {
        set.status = result.error === 'not_found' ? 404 : 400
        return { success: false, error: result.message }
      }
      return { success: true, data: result.data }
    },
    { beforeHandle: [guardAuth, guardRole('HR')], params: t.Object({ id: t.String() }) }
  )

  // POST /payroll/:id/regenerate — generated → generated (reprocess)
  .post(
    '/:id/regenerate',
    async ({ db, params, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const result = await regeneratePayrollService(db, params.id)
      if (!result.success) {
        set.status = result.error === 'not_found' ? 404 : 400
        return { success: false, error: result.message }
      }
      return { success: true, data: result.data }
    },
    { beforeHandle: [guardAuth, guardRole('HR')], params: t.Object({ id: t.String() }) }
  )

  // POST /payroll/:id/close — generated → closed
  .post(
    '/:id/close',
    async ({ db, params, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const result = await closePayrollService(db, params.id)
      if (!result.success) {
        set.status = result.error === 'not_found' ? 404 : 400
        return { success: false, error: result.message }
      }
      return { success: true, data: result.data }
    },
    { beforeHandle: [guardAuth, guardRole('ADMIN')], params: t.Object({ id: t.String() }) }
  )

  // POST /payroll/:id/reopen — closed → generated
  .post(
    '/:id/reopen',
    async ({ db, params, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const result = await reopenPayrollService(db, params.id)
      if (!result.success) {
        set.status = result.error === 'not_found' ? 404 : 400
        return { success: false, error: result.message }
      }
      return { success: true, data: result.data }
    },
    { beforeHandle: [guardAuth, guardRole('ADMIN')], params: t.Object({ id: t.String() }) }
  )

  // Legacy alias: POST /payroll/:id/process → generate
  .post(
    '/:id/process',
    async ({ db, params, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const result = await generatePayrollService(db, params.id)
      if (!result.success) {
        set.status = result.error === 'not_found' ? 404 : 400
        return { success: false, error: result.message }
      }
      return { success: true, data: result.data }
    },
    { beforeHandle: [guardAuth, guardRole('HR')], params: t.Object({ id: t.String() }) }
  )
