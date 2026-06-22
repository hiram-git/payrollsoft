import { Elysia, t } from 'elysia'
import { authPlugin, guardAuth, guardPermission } from '../../middleware/auth'
import { tenantPlugin } from '../../middleware/tenant'
import {
  createCreditorService,
  getCreditorService,
  listCreditorsService,
  updateCreditorService,
} from './service'

const PaymentFields = {
  bankId: t.Optional(t.Nullable(t.String())),
  accountNumber: t.Optional(t.Nullable(t.String({ maxLength: 40 }))),
  accountType: t.Optional(t.Nullable(t.Union([t.Literal('savings'), t.Literal('checking')]))),
  paymentMethod: t.Optional(
    t.Union([t.Literal('ach'), t.Literal('check'), t.Literal('cash')])
  ),
  beneficiaryName: t.Optional(t.Nullable(t.String({ maxLength: 255 }))),
}

const CreateBody = t.Object({
  code: t.String({ minLength: 1, maxLength: 20 }),
  name: t.String({ minLength: 1, maxLength: 255 }),
  description: t.Optional(t.Nullable(t.String())),
  ...PaymentFields,
})

const UpdateBody = t.Object({
  name: t.Optional(t.String({ minLength: 1, maxLength: 255 })),
  description: t.Optional(t.Nullable(t.String())),
  isActive: t.Optional(t.Boolean()),
  ...PaymentFields,
})

export const creditorRoutes = new Elysia({ prefix: '/creditors' })
  .use(authPlugin)
  .use(tenantPlugin)

  // GET /creditors
  .get(
    '/',
    async ({ db, query, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const data = await listCreditorsService(db, query.all === 'true')
      return { success: true, data }
    },
    {
      beforeHandle: [guardAuth, guardPermission('creditors:read')],
      query: t.Object({ all: t.Optional(t.String()) }),
    }
  )

  // GET /creditors/:id
  .get(
    '/:id',
    async ({ db, params, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const data = await getCreditorService(db, params.id)
      if (!data) {
        set.status = 404
        return { success: false, error: 'Acreedor no encontrado' }
      }
      return { success: true, data }
    },
    {
      beforeHandle: [guardAuth, guardPermission('creditors:read')],
      params: t.Object({ id: t.String() }),
    }
  )

  // POST /creditors
  .post(
    '/',
    async ({ db, body, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const result = await createCreditorService(db, body)
      if (!result.success) {
        set.status = result.error === 'duplicate_code' ? 409 : 400
        return { success: false, error: result.message }
      }
      set.status = 201
      return { success: true, data: result.data }
    },
    { beforeHandle: [guardAuth, guardPermission('creditors:create')], body: CreateBody }
  )

  // PUT /creditors/:id
  .put(
    '/:id',
    async ({ db, params, body, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const result = await updateCreditorService(db, params.id, body)
      if (!result.success) {
        set.status = result.error === 'not_found' ? 404 : 400
        return { success: false, error: result.message }
      }
      return { success: true, data: result.data }
    },
    {
      beforeHandle: [guardAuth, guardPermission('creditors:update')],
      params: t.Object({ id: t.String() }),
      body: UpdateBody,
    }
  )
