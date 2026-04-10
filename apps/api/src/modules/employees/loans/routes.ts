import { Elysia, t } from 'elysia'
import { authPlugin, guardAuth, guardRole } from '../../../middleware/auth'
import { tenantPlugin } from '../../../middleware/tenant'
import {
  closeLoanService,
  createLoanService,
  getLoanService,
  listLoansService,
  updateLoanService,
} from './service'

const LoanBody = t.Object({
  employeeId: t.String({ minLength: 1 }),
  amount: t.String({ minLength: 1 }),
  balance: t.String({ minLength: 1 }),
  installment: t.String({ minLength: 1 }),
  startDate: t.String({ minLength: 1 }),
  endDate: t.Optional(t.Nullable(t.String())),
})

const LoanUpdateBody = t.Object({
  amount: t.Optional(t.String({ minLength: 1 })),
  balance: t.Optional(t.String({ minLength: 1 })),
  installment: t.Optional(t.String({ minLength: 1 })),
  startDate: t.Optional(t.String({ minLength: 1 })),
  endDate: t.Optional(t.Nullable(t.String())),
})

export const loansRoutes = new Elysia({ prefix: '/loans' })
  .use(authPlugin)
  .use(tenantPlugin)

  // List loans for a given employee: GET /loans?employeeId=xxx
  .get(
    '/',
    async ({ db, query, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      if (!query.employeeId) {
        set.status = 400
        return { success: false, error: 'employeeId query parameter required' }
      }
      const data = await listLoansService(db, query.employeeId)
      return { success: true, data }
    },
    {
      beforeHandle: [guardAuth, guardRole('VIEWER')],
      query: t.Object({ employeeId: t.Optional(t.String()) }),
    }
  )

  .get(
    '/:id',
    async ({ db, params, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const row = await getLoanService(db, params.id)
      if (!row) {
        set.status = 404
        return { success: false, error: 'Loan not found' }
      }
      return { success: true, data: row }
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
      const result = await createLoanService(db, body)
      if (!result.success) {
        set.status = result.error === 'employee_not_found' ? 404 : 400
        return { success: false, error: result.message }
      }
      set.status = 201
      return { success: true, data: result.data }
    },
    { beforeHandle: [guardAuth, guardRole('HR')], body: LoanBody }
  )

  .put(
    '/:id',
    async ({ db, params, body, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const result = await updateLoanService(db, params.id, body)
      if (!result.success) {
        set.status = result.error === 'not_found' ? 404 : 400
        return { success: false, error: result.message }
      }
      return { success: true, data: result.data }
    },
    {
      beforeHandle: [guardAuth, guardRole('HR')],
      params: t.Object({ id: t.String() }),
      body: LoanUpdateBody,
    }
  )

  // Close/deactivate a loan
  .delete(
    '/:id',
    async ({ db, params, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const result = await closeLoanService(db, params.id)
      if (!result.success) {
        set.status = result.error === 'not_found' ? 404 : 400
        return { success: false, error: result.message }
      }
      return { success: true, data: result.data }
    },
    { beforeHandle: [guardAuth, guardRole('HR')], params: t.Object({ id: t.String() }) }
  )
