import { Elysia, t } from 'elysia'
import { authPlugin, guardAuth, guardRole } from '../../middleware/auth'
import { tenantPlugin } from '../../middleware/tenant'
import {
  activateCreditorService,
  createCreditorService,
  deactivateCreditorService,
  getCreditorService,
  listCreditorsService,
  updateCreditorService,
} from './service'

const CreditorBody = t.Object({
  code: t.String({ minLength: 1, maxLength: 20 }),
  name: t.String({ minLength: 1, maxLength: 255 }),
})

const CreditorUpdateBody = t.Object({
  name: t.Optional(t.String({ minLength: 1, maxLength: 255 })),
})

export const creditorsRoutes = new Elysia({ prefix: '/creditors' })
  .use(authPlugin)
  .use(tenantPlugin)

  .get(
    '/',
    async ({ db, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const data = await listCreditorsService(db)
      return { success: true, data }
    },
    { beforeHandle: [guardAuth, guardRole('VIEWER')] }
  )

  .get(
    '/:id',
    async ({ db, params, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const row = await getCreditorService(db, params.id)
      if (!row) {
        set.status = 404
        return { success: false, error: 'Acreedor no encontrado' }
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
      const result = await createCreditorService(db, body)
      if (!result.success) {
        set.status =
          result.error === 'code_taken' || result.error === 'concept_code_taken' ? 409 : 400
        return { success: false, error: result.message }
      }
      set.status = 201
      return { success: true, data: result.data }
    },
    { beforeHandle: [guardAuth, guardRole('HR')], body: CreditorBody }
  )

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
      beforeHandle: [guardAuth, guardRole('HR')],
      params: t.Object({ id: t.String() }),
      body: CreditorUpdateBody,
    }
  )

  .post(
    '/:id/deactivate',
    async ({ db, params, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const result = await deactivateCreditorService(db, params.id)
      if (!result.success) {
        set.status = result.error === 'not_found' ? 404 : 400
        return { success: false, error: result.message }
      }
      return { success: true, data: result.data }
    },
    { beforeHandle: [guardAuth, guardRole('ADMIN')], params: t.Object({ id: t.String() }) }
  )

  .post(
    '/:id/activate',
    async ({ db, params, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const result = await activateCreditorService(db, params.id)
      if (!result.success) {
        set.status = result.error === 'not_found' ? 404 : 400
        return { success: false, error: result.message }
      }
      return { success: true, data: result.data }
    },
    { beforeHandle: [guardAuth, guardRole('ADMIN')], params: t.Object({ id: t.String() }) }
  )
