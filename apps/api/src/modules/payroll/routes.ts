import { determinarPeriodoTrimestral, getThirteenthPeriods } from '@payroll/core'
import { Elysia, t } from 'elysia'
import { authPlugin, guardAuth, guardRole } from '../../middleware/auth'
import { tenantPlugin } from '../../middleware/tenant'
import {
  getPayrollReportService,
  markPayrollReportGeneratedService,
  markPayrollReportNotGeneratedService,
} from './report-service'
import {
  closePayrollService,
  createPayrollService,
  createThirteenthPayrollService,
  deletePayrollService,
  generatePayrollService,
  getPayrollLineService,
  getPayrollService,
  listPayrollsService,
  regenerateEmployeeService,
  regeneratePayrollService,
  reopenPayrollService,
  revertPayrollService,
  updatePayrollService,
} from './service'

const PayrollBody = t.Object({
  name: t.String({ minLength: 1, maxLength: 255 }),
  type: t.String({ minLength: 1 }),
  frequency: t.String({ minLength: 1 }),
  periodStart: t.String({ minLength: 1 }),
  periodEnd: t.String({ minLength: 1 }),
  paymentDate: t.Optional(t.Nullable(t.String())),
  payrollTypeId: t.Optional(t.Nullable(t.String())),
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
      const data = await listPayrollsService(
        db,
        {
          status: query.status,
          type: query.type,
          year: query.year ? Number(query.year) : undefined,
          payrollTypeId: query.payrollTypeId,
        },
        query.page ? Number(query.page) : 1
      )
      return { success: true, ...data }
    },
    {
      beforeHandle: [guardAuth, guardRole('VIEWER')],
      query: t.Object({
        status: t.Optional(t.String()),
        type: t.Optional(t.String()),
        year: t.Optional(t.String()),
        payrollTypeId: t.Optional(t.String()),
        page: t.Optional(t.String()),
      }),
    }
  )

  .get(
    '/:id',
    async ({ db, params, query, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const linesPage = query.linesPage ? Number(query.linesPage) : 1
      const linesLimit = query.linesLimit ? Number(query.linesLimit) : 50
      const search = query.search || undefined
      const data = await getPayrollService(db, params.id, linesPage, linesLimit, search)
      if (!data) {
        set.status = 404
        return { success: false, error: 'Payroll not found' }
      }
      return { success: true, data }
    },
    {
      beforeHandle: [guardAuth, guardRole('VIEWER')],
      params: t.Object({ id: t.String() }),
      query: t.Object({
        linesPage: t.Optional(t.String()),
        linesLimit: t.Optional(t.String()),
        search: t.Optional(t.String()),
      }),
    }
  )

  .get(
    '/:id/line/:lineId',
    async ({ db, params, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const data = await getPayrollLineService(db, params.id, params.lineId)
      if (!data) {
        set.status = 404
        return { success: false, error: 'Line not found' }
      }
      return { success: true, data }
    },
    {
      beforeHandle: [guardAuth, guardRole('VIEWER')],
      params: t.Object({ id: t.String(), lineId: t.String() }),
    }
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

  // POST /payroll/:id/revert — generated → created
  .post(
    '/:id/revert',
    async ({ db, params, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const result = await revertPayrollService(db, params.id)
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

  // GET /payroll/thirteenth/period?date=YYYY-MM-DD — return period info for a date
  .get(
    '/thirteenth/period',
    ({ query }) => {
      const date = query.date ?? new Date().toISOString().slice(0, 10)
      const period = determinarPeriodoTrimestral(date)
      return { success: true, data: period }
    },
    {
      beforeHandle: [guardAuth, guardRole('VIEWER')],
      query: t.Object({ date: t.Optional(t.String()) }),
    }
  )

  // GET /payroll/thirteenth/periods?year=2025 — return all 3 periods for a year
  .get(
    '/thirteenth/periods',
    ({ query }) => {
      const year = Number(query.year ?? new Date().getFullYear())
      const periods = getThirteenthPeriods(year)
      return { success: true, data: periods }
    },
    {
      beforeHandle: [guardAuth, guardRole('VIEWER')],
      query: t.Object({ year: t.Optional(t.String()) }),
    }
  )

  // POST /payroll/thirteenth — create XIII mes payroll auto-detecting the trimestral period
  .post(
    '/thirteenth',
    async ({ db, body, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const result = await createThirteenthPayrollService(
        db,
        body.date ?? undefined,
        body.name ?? undefined
      )
      set.status = 201
      return { success: true, data: result.data, period: result.period }
    },
    {
      beforeHandle: [guardAuth, guardRole('HR')],
      body: t.Object({
        date: t.Optional(t.String()),
        name: t.Optional(t.String()),
      }),
    }
  )

  // POST /payroll/:id/lines/:lineId/regenerate — reprocess a single employee
  .post(
    '/:id/lines/:lineId/regenerate',
    async ({ db, params, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const result = await regenerateEmployeeService(db, params.id, params.lineId)
      if (!result.success) {
        set.status = result.error === 'not_found' ? 404 : 400
        return { success: false, error: result.message }
      }
      return { success: true, data: result.data }
    },
    {
      beforeHandle: [guardAuth, guardRole('HR')],
      params: t.Object({ id: t.String(), lineId: t.String() }),
    }
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

  // ── Report state machine ─────────────────────────────────────────────────
  // GET /payroll/:id/report — current generation state (lazy: returns
  // `not_generated` if no row exists yet).
  .get(
    '/:id/report',
    async ({ db, params, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const result = await getPayrollReportService(db, params.id)
      if (!result.success) {
        set.status = 404
        return { success: false, error: 'Payroll not found' }
      }
      return { success: true, data: result.data }
    },
    {
      beforeHandle: [guardAuth, guardRole('VIEWER')],
      params: t.Object({ id: t.String() }),
    }
  )

  // POST /payroll/:id/report — record a successful generation. Body carries
  // the absolute file path the web process wrote to; the API only owns the
  // row state and trusts the path passed by an authenticated writer.
  .post(
    '/:id/report',
    async ({ db, params, body, user, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const result = await markPayrollReportGeneratedService(db, {
        payrollId: params.id,
        pdfPath: body.pdfPath ?? null,
        generatedBy: user?.userId ?? null,
      })
      if (!result.success) {
        set.status = 404
        return { success: false, error: 'Payroll not found' }
      }
      return { success: true, data: result.data }
    },
    {
      beforeHandle: [guardAuth, guardRole('HR')],
      params: t.Object({ id: t.String() }),
      // Null when the tenant uses on_demand mode (no file persisted).
      body: t.Object({ pdfPath: t.Optional(t.Nullable(t.String())) }),
    }
  )

  // POST /payroll/:id/report/regenerate — flip the row to not_generated.
  // Does not touch the PDF file; the caller immediately triggers a new
  // generation which overwrites it atomically.
  .post(
    '/:id/report/regenerate',
    async ({ db, params, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const result = await markPayrollReportNotGeneratedService(db, params.id)
      if (!result.success) {
        set.status = 404
        return { success: false, error: 'Payroll not found' }
      }
      return { success: true, data: result.data }
    },
    {
      beforeHandle: [guardAuth, guardRole('HR')],
      params: t.Object({ id: t.String() }),
    }
  )
