import { Elysia, t } from 'elysia'
import { authPlugin, guardAuth, guardRole } from '../../middleware/auth'
import { tenantPlugin } from '../../middleware/tenant'
import {
  createPositionService,
  deletePositionService,
  getPositionService,
  listPositionsService,
  updatePositionService,
} from './service'

const PositionBody = t.Object({
  code: t.String({ minLength: 1, maxLength: 20 }),
  name: t.String({ minLength: 1, maxLength: 255 }),
  salary: t.String({ minLength: 1 }),
  cargoId: t.Optional(t.Nullable(t.String())),
  departamentoId: t.Optional(t.Nullable(t.String())),
  funcionId: t.Optional(t.Nullable(t.String())),
})

const PositionUpdateBody = t.Object({
  code: t.Optional(t.String({ minLength: 1, maxLength: 20 })),
  name: t.Optional(t.String({ minLength: 1, maxLength: 255 })),
  salary: t.Optional(t.String({ minLength: 1 })),
  cargoId: t.Optional(t.Nullable(t.String())),
  departamentoId: t.Optional(t.Nullable(t.String())),
  funcionId: t.Optional(t.Nullable(t.String())),
})

export const positionsRoutes = new Elysia({ prefix: '/positions' })
  .use(authPlugin)
  .use(tenantPlugin)

  .get(
    '/',
    async ({ db, query, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const onlyActive = query.isActive === 'true'
      return listPositionsService(db, onlyActive)
    },
    {
      beforeHandle: [guardAuth, guardRole('VIEWER')],
      query: t.Object({ isActive: t.Optional(t.String()) }),
    }
  )

  .get(
    '/:id',
    async ({ db, params, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const data = await getPositionService(db, params.id)
      if (!data) {
        set.status = 404
        return { success: false, error: 'Not found' }
      }
      return { success: true, data }
    },
    {
      beforeHandle: [guardAuth, guardRole('VIEWER')],
      params: t.Object({ id: t.String() }),
    }
  )

  .post(
    '/',
    async ({ db, body, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const result = await createPositionService(db, body)
      if (!result.success) {
        set.status = result.error === 'code_taken' ? 409 : 400
        return result
      }
      set.status = 201
      return result
    },
    {
      beforeHandle: [guardAuth, guardRole('HR')],
      body: PositionBody,
    }
  )

  .put(
    '/:id',
    async ({ db, params, body, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const result = await updatePositionService(db, params.id, body)
      if (!result.success) {
        set.status = result.error === 'not_found' ? 404 : 409
        return result
      }
      return result
    },
    {
      beforeHandle: [guardAuth, guardRole('HR')],
      params: t.Object({ id: t.String() }),
      body: PositionUpdateBody,
    }
  )

  .delete(
    '/:id',
    async ({ db, params, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const result = await deletePositionService(db, params.id)
      if (!result.success) {
        set.status = 404
        return result
      }
      return result
    },
    {
      beforeHandle: [guardAuth, guardRole('ADMIN')],
      params: t.Object({ id: t.String() }),
    }
  )
