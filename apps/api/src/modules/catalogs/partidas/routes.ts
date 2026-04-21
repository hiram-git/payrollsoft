import { Elysia, t } from 'elysia'
import { authPlugin, guardAuth, guardRole } from '../../../middleware/auth'
import { tenantPlugin } from '../../../middleware/tenant'
import {
  createPartidaService,
  deactivatePartidaService,
  getPartidaService,
  listPartidasService,
  updatePartidaService,
} from './service'

const PartidaBody = t.Object({
  code: t.String({ minLength: 1, maxLength: 20 }),
  name: t.String({ minLength: 1, maxLength: 255 }),
})

const PartidaUpdateBody = t.Object({
  code: t.Optional(t.String({ minLength: 1, maxLength: 20 })),
  name: t.Optional(t.String({ minLength: 1, maxLength: 255 })),
})

export const partidasRoutes = new Elysia({ prefix: '/partidas' })
  .use(authPlugin)
  .use(tenantPlugin)

  .get(
    '/',
    async ({ db, query, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const data = await listPartidasService(db, query.search)
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
      const row = await getPartidaService(db, params.id)
      if (!row) {
        set.status = 404
        return { success: false, error: 'Partida not found' }
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
      const result = await createPartidaService(db, body)
      if (!result.success) {
        set.status = result.error === 'code_taken' ? 409 : 400
        return { success: false, error: result.message }
      }
      set.status = 201
      return { success: true, data: result.data }
    },
    { beforeHandle: [guardAuth, guardRole('HR')], body: PartidaBody }
  )

  .put(
    '/:id',
    async ({ db, params, body, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const result = await updatePartidaService(db, params.id, body)
      if (!result.success) {
        set.status = result.error === 'not_found' ? 404 : 409
        return { success: false, error: result.message }
      }
      return { success: true, data: result.data }
    },
    {
      beforeHandle: [guardAuth, guardRole('HR')],
      params: t.Object({ id: t.String() }),
      body: PartidaUpdateBody,
    }
  )

  .delete(
    '/:id',
    async ({ db, params, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const result = await deactivatePartidaService(db, params.id)
      if (!result.success) {
        set.status = result.error === 'not_found' ? 404 : 400
        return { success: false, error: result.message }
      }
      return { success: true, data: result.data }
    },
    { beforeHandle: [guardAuth, guardRole('ADMIN')], params: t.Object({ id: t.String() }) }
  )
