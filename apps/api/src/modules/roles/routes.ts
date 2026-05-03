import { permissionsCatalog } from '@payroll/db'
import { Elysia, t } from 'elysia'
import { publicDb } from '../../config/db'
import { authPlugin, guardAuth, guardPermission } from '../../middleware/auth'
import { guardTenantMatchesToken, tenantPlugin } from '../../middleware/tenant'
import {
  createRole,
  deleteRole,
  getRole,
  listRoles,
  listUserRoles,
  roleCodeExists,
  setRoleInheritance,
  setRolePermissions,
  setUserRoles,
  updateRole,
} from './service'

const RoleCode = t.String({ minLength: 1, maxLength: 50, pattern: '^[a-z][a-z0-9_]*$' })

/**
 * Tenant RBAC management.
 *
 *  GET    /roles                          list roles
 *  POST   /roles                          create a custom role         — roles:create
 *  GET    /roles/:id                      role detail (perms+graph+holders)
 *  PATCH  /roles/:id                      edit name/description        — roles:update
 *  DELETE /roles/:id                      delete (only non-system)     — roles:delete
 *  PUT    /roles/:id/permissions          replace permission grants    — roles:update
 *  PUT    /roles/:id/inheritance          replace parent roles         — roles:update
 *  PUT    /users/:userId/roles            replace a user's role set    — roles:assign
 *  GET    /users/:userId/roles            list a user's roles
 */
export const roleRoutes = new Elysia({ prefix: '/roles' })
  .use(authPlugin)
  .use(tenantPlugin)

  // ── GET /roles ─────────────────────────────────────────────────────────────
  .get(
    '/',
    async ({ db, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      return { success: true, data: await listRoles(db) }
    },
    { beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('roles:read')] }
  )

  // ── POST /roles ────────────────────────────────────────────────────────────
  .post(
    '/',
    async ({ db, body, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      if (await roleCodeExists(db, body.code)) {
        set.status = 409
        return { success: false, error: 'Role code already exists' }
      }
      const role = await createRole(db, body)
      set.status = 201
      return { success: true, data: role }
    },
    {
      beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('roles:create')],
      body: t.Object({
        code: RoleCode,
        name: t.String({ minLength: 1, maxLength: 120 }),
        description: t.Optional(t.Nullable(t.String({ maxLength: 500 }))),
      }),
    }
  )

  // ── GET /roles/:id ─────────────────────────────────────────────────────────
  .get(
    '/:id',
    async ({ db, params, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const role = await getRole(db, params.id)
      if (!role) {
        set.status = 404
        return { success: false, error: 'Role not found' }
      }
      return { success: true, data: role }
    },
    {
      beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('roles:read')],
      params: t.Object({ id: t.String() }),
    }
  )

  // ── PATCH /roles/:id ───────────────────────────────────────────────────────
  .patch(
    '/:id',
    async ({ db, params, body, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const updated = await updateRole(db, params.id, body)
      if (!updated) {
        set.status = 404
        return { success: false, error: 'Role not found' }
      }
      return { success: true, data: updated }
    },
    {
      beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('roles:update')],
      params: t.Object({ id: t.String() }),
      body: t.Object({
        name: t.Optional(t.String({ minLength: 1, maxLength: 120 })),
        description: t.Optional(t.Nullable(t.String({ maxLength: 500 }))),
      }),
    }
  )

  // ── DELETE /roles/:id ──────────────────────────────────────────────────────
  .delete(
    '/:id',
    async ({ db, params, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const result = await deleteRole(db, params.id)
      if (result === 'not_found') {
        set.status = 404
        return { success: false, error: 'Role not found' }
      }
      if (result === 'system') {
        set.status = 409
        return { success: false, error: 'System roles cannot be deleted' }
      }
      return { success: true }
    },
    {
      beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('roles:delete')],
      params: t.Object({ id: t.String() }),
    }
  )

  // ── GET /roles/permissions/catalog ─────────────────────────────────────────
  // The full catalog, exposed to anyone who can read roles. Tenant admins
  // need it to render the permission tree without the super-admin endpoint.
  .get(
    '/permissions/catalog',
    async () => {
      const data = await publicDb
        .select()
        .from(permissionsCatalog)
        .orderBy(permissionsCatalog.module)
      return { success: true, data }
    },
    { beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('roles:read')] }
  )

  // ── PUT /roles/:id/permissions ─────────────────────────────────────────────
  .put(
    '/:id/permissions',
    async ({ db, params, body, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const result = await setRolePermissions(db, params.id, body.permissions)
      if (!result.ok) {
        set.status = 404
        return { success: false, error: 'Role not found' }
      }
      return { success: true, data: { granted: result.granted, rejected: result.rejected } }
    },
    {
      beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('roles:update')],
      params: t.Object({ id: t.String() }),
      body: t.Object({
        permissions: t.Array(t.String({ maxLength: 80 }), { maxItems: 200 }),
      }),
    }
  )

  // ── PUT /roles/:id/inheritance ─────────────────────────────────────────────
  .put(
    '/:id/inheritance',
    async ({ db, params, body, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const result = await setRoleInheritance(db, params.id, body.parents)
      if (!result.ok) {
        set.status = result.error === 'not_found' ? 404 : 400
        return { success: false, error: result.error }
      }
      return { success: true, data: { parents: result.parents } }
    },
    {
      beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('roles:update')],
      params: t.Object({ id: t.String() }),
      body: t.Object({
        parents: t.Array(t.String(), { maxItems: 50 }),
      }),
    }
  )

/**
 * User-role assignment lives at /users/:userId/roles to keep the URL
 * grammar consistent with the rest of the user-management module from
 * Phase 4.2.
 */
export const userRoleRoutes = new Elysia({ prefix: '/users' })
  .use(authPlugin)
  .use(tenantPlugin)

  .get(
    '/:userId/roles',
    async ({ db, params, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      return { success: true, data: await listUserRoles(db, params.userId) }
    },
    {
      beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('users:read')],
      params: t.Object({ userId: t.String() }),
    }
  )

  .put(
    '/:userId/roles',
    async ({ db, params, body, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const assigned = await setUserRoles(db, params.userId, body.roleIds)
      return { success: true, data: { assigned } }
    },
    {
      beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('roles:assign')],
      params: t.Object({ userId: t.String() }),
      body: t.Object({
        roleIds: t.Array(t.String(), { maxItems: 50 }),
      }),
    }
  )
