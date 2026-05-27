import { Elysia, t } from 'elysia'
import { hashPassword } from '../../lib/password'
import { authPlugin, guardAuth, guardPermission } from '../../middleware/auth'
import { guardTenantMatchesToken, tenantPlugin } from '../../middleware/tenant'
import {
  createUser,
  deactivateUser,
  getUser,
  listUsers,
  reactivateUser,
  setUserPassword,
  updateUser,
} from './service'

/**
 * Tenant user administration.
 *
 *  GET    /tenant-users                  list users (search, isActive)
 *  POST   /tenant-users                  create user (sends none — admin sets pwd)
 *  GET    /tenant-users/:id              user detail
 *  PATCH  /tenant-users/:id              edit name
 *  POST   /tenant-users/:id/deactivate   soft-deactivate
 *  POST   /tenant-users/:id/reactivate   re-enable
 *  POST   /tenant-users/:id/password     rotate password
 *
 * The `tenant-users` prefix avoids colliding with /users/:userId/roles
 * from Phase 4.1, which targets a different concern.
 */
export const tenantUserRoutes = new Elysia({ prefix: '/tenant-users' })
  .use(authPlugin)
  .use(tenantPlugin)

  .get(
    '/',
    async ({ db, query, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const isActive =
        query.isActive === 'true' ? true : query.isActive === 'false' ? false : undefined
      return {
        success: true,
        data: await listUsers(db, { search: query.search, isActive }),
      }
    },
    {
      beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('users:read')],
      query: t.Object({
        search: t.Optional(t.String()),
        isActive: t.Optional(t.String()),
      }),
    }
  )

  .post(
    '/',
    async ({ db, body, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const passwordHash = await hashPassword(body.password)
      const result = await createUser(db, {
        email: body.email,
        name: body.name,
        passwordHash,
      })
      if (!result.ok) {
        set.status = 409
        return { success: false, error: result.error }
      }
      set.status = 201
      return { success: true, data: result.user }
    },
    {
      beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('users:create')],
      body: t.Object({
        email: t.String({ format: 'email' }),
        name: t.String({ minLength: 1, maxLength: 255 }),
        password: t.String({ minLength: 12, maxLength: 256 }),
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
      const user = await getUser(db, params.id)
      if (!user) {
        set.status = 404
        return { success: false, error: 'User not found' }
      }
      return { success: true, data: user }
    },
    {
      beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('users:read')],
      params: t.Object({ id: t.String() }),
    }
  )

  .patch(
    '/:id',
    async ({ db, params, body, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const user = await updateUser(db, params.id, body)
      if (!user) {
        set.status = 404
        return { success: false, error: 'User not found' }
      }
      return { success: true, data: user }
    },
    {
      beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('users:update')],
      params: t.Object({ id: t.String() }),
      body: t.Object({
        name: t.Optional(t.String({ minLength: 1, maxLength: 255 })),
      }),
    }
  )

  .post(
    '/:id/deactivate',
    async ({ db, params, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const result = await deactivateUser(db, params.id)
      if (!result.ok) {
        set.status = result.error === 'not_found' ? 404 : 409
        return { success: false, error: result.error }
      }
      return { success: true, data: result.user }
    },
    {
      beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('users:deactivate')],
      params: t.Object({ id: t.String() }),
    }
  )

  .post(
    '/:id/reactivate',
    async ({ db, params, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const user = await reactivateUser(db, params.id)
      if (!user) {
        set.status = 404
        return { success: false, error: 'User not found' }
      }
      return { success: true, data: user }
    },
    {
      beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('users:update')],
      params: t.Object({ id: t.String() }),
    }
  )

  .post(
    '/:id/password',
    async ({ db, params, body, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const passwordHash = await hashPassword(body.password)
      const ok = await setUserPassword(db, params.id, passwordHash)
      if (!ok) {
        set.status = 404
        return { success: false, error: 'User not found' }
      }
      return { success: true }
    },
    {
      beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('users:update')],
      params: t.Object({ id: t.String() }),
      body: t.Object({
        password: t.String({ minLength: 12, maxLength: 256 }),
      }),
    }
  )
