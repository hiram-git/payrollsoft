import { Elysia, t } from 'elysia'
import { authPlugin, guardAuth, guardRole } from '../../../middleware/auth'
import { tenantPlugin } from '../../../middleware/tenant'
import {
  createCargoService,
  deactivateCargoService,
  getCargoService,
  listCargosService,
  updateCargoService,
} from './service'

const CargoBody = t.Object({
  code: t.String({ minLength: 1, maxLength: 20 }),
  name: t.String({ minLength: 1, maxLength: 255 }),
  description: t.Optional(t.Nullable(t.String({ maxLength: 500 }))),
})

const CargoUpdateBody = t.Object({
  code: t.Optional(t.String({ minLength: 1, maxLength: 20 })),
  name: t.Optional(t.String({ minLength: 1, maxLength: 255 })),
  description: t.Optional(t.Nullable(t.String({ maxLength: 500 }))),
})

export const cargosRoutes = new Elysia({ prefix: '/cargos' })
  .use(authPlugin)
  .use(tenantPlugin)

  .get(
    '/',
    async ({ db, query, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const data = await listCargosService(db, query.search)
      return { success: true, data }
    },
    {
      beforeHandle: [guardAuth, guardRole('VIEWER')],
      query: t.Object({ search: t.Optional(t.String()) }),
    }
  )

  .get(
    '/:id',
    async ({ db, params, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const row = await getCargoService(db, params.id)
      if (!row) {
        set.status = 404
        return { success: false, error: 'Cargo not found' }
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
      const result = await createCargoService(db, body)
      if (!result.success) {
        set.status = result.error === 'code_taken' ? 409 : 400
        return { success: false, error: result.message }
      }
      set.status = 201
      return { success: true, data: result.data }
    },
    { beforeHandle: [guardAuth, guardRole('HR')], body: CargoBody }
  )

  .put(
    '/:id',
    async ({ db, params, body, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const result = await updateCargoService(db, params.id, body)
      if (!result.success) {
        set.status = result.error === 'not_found' ? 404 : 409
        return { success: false, error: result.message }
      }
      return { success: true, data: result.data }
    },
    {
      beforeHandle: [guardAuth, guardRole('HR')],
      params: t.Object({ id: t.String() }),
      body: CargoUpdateBody,
    }
  )

  .delete(
    '/:id',
    async ({ db, params, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const result = await deactivateCargoService(db, params.id)
      if (!result.success) {
        set.status = result.error === 'not_found' ? 404 : 400
        return { success: false, error: result.message }
      }
      return { success: true, data: result.data }
    },
    { beforeHandle: [guardAuth, guardRole('ADMIN')], params: t.Object({ id: t.String() }) }
  )
