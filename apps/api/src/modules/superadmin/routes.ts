import { validateTenantSlug } from '@payroll/utils'
import { Elysia, t } from 'elysia'
import { publicDb } from '../../config/db'
import { env } from '../../config/env'
import { hashPassword } from '../../lib/password'
import { authPlugin, guardSuperAdmin } from '../../middleware/auth'
import {
  changeTenantStatus,
  createTenant,
  findTenantBySlug,
  getProvisioningStatus,
  listPermissionsCatalog,
  listSuperAdminAudit,
  listTenants,
  resetTenantAdminPassword,
} from './service'

/**
 * Super-admin only — global tenant management.
 *
 *  GET    /superadmin/tenants                       list every tenant
 *  GET    /superadmin/tenants/check-slug/:slug      slug availability + format
 *  POST   /superadmin/tenants                       provision a new tenant
 *  GET    /superadmin/tenants/:slug                 read one tenant + its provisioning row
 *  PATCH  /superadmin/tenants/:slug                 suspend / reactivate
 *  DELETE /superadmin/tenants/:slug                 archive (soft delete)
 *  POST   /superadmin/tenants/:slug/admin/reset     rotate the tenant admin password
 *
 * All routes require an authenticated super-admin (JWT type='super_admin').
 */
export const superadminRoutes = new Elysia({ prefix: '/superadmin' })
  .use(authPlugin)

  // ── GET /superadmin/tenants ────────────────────────────────────────────────
  .get('/tenants', async () => ({ success: true, data: await listTenants(publicDb) }), {
    beforeHandle: [guardSuperAdmin],
  })

  // ── GET /superadmin/tenants/check-slug/:slug ───────────────────────────────
  .get(
    '/tenants/check-slug/:slug',
    async ({ params }) => {
      const result = validateTenantSlug(params.slug)
      if (!result.ok) {
        return {
          success: true,
          data: { available: false, reason: result.error, message: result.message },
        }
      }
      const existing = await findTenantBySlug(publicDb, result.slug)
      return {
        success: true,
        data: existing
          ? { available: false, reason: 'TAKEN', message: 'Slug already in use.' }
          : { available: true, slug: result.slug },
      }
    },
    { beforeHandle: [guardSuperAdmin] }
  )

  // ── POST /superadmin/tenants ───────────────────────────────────────────────
  .post(
    '/tenants',
    async ({ body, user, set }) => {
      const passwordHash = await hashPassword(body.adminPassword)

      const result = await createTenant(env.DATABASE_URL, {
        slug: body.slug,
        name: body.name,
        contactEmail: body.contactEmail ?? null,
        admin: {
          email: body.adminEmail,
          name: body.adminName,
          passwordHash,
        },
        superAdminId: user?.userId,
      })

      if (!result.ok) {
        const status =
          result.error.kind === 'slug_taken'
            ? 409
            : result.error.kind === 'invalid_slug' || result.error.kind === 'admin_email_invalid'
              ? 400
              : 500
        set.status = status
        return { success: false, error: result.error }
      }

      set.status = 201
      return { success: true, data: result.tenant }
    },
    {
      beforeHandle: [guardSuperAdmin],
      body: t.Object({
        slug: t.String({ minLength: 3, maxLength: 50 }),
        name: t.String({ minLength: 1, maxLength: 255 }),
        contactEmail: t.Optional(t.String({ format: 'email' })),
        adminEmail: t.String({ format: 'email' }),
        adminName: t.String({ minLength: 1, maxLength: 255 }),
        adminPassword: t.String({ minLength: 12, maxLength: 256 }),
      }),
    }
  )

  // ── GET /superadmin/tenants/:slug ──────────────────────────────────────────
  .get(
    '/tenants/:slug',
    async ({ params, set }) => {
      const tenant = await findTenantBySlug(publicDb, params.slug)
      if (!tenant) {
        set.status = 404
        return { success: false, error: 'Tenant not found' }
      }
      const provisioning = await getProvisioningStatus(publicDb, tenant.id)
      return { success: true, data: { tenant, provisioning } }
    },
    { beforeHandle: [guardSuperAdmin] }
  )

  // ── PATCH /superadmin/tenants/:slug ────────────────────────────────────────
  .patch(
    '/tenants/:slug',
    async ({ params, body, user, set }) => {
      if (!user) {
        set.status = 401
        return { success: false, error: 'Unauthorized' }
      }
      const next = body.status
      const updated = await changeTenantStatus(
        publicDb,
        env.DATABASE_URL,
        user.userId,
        params.slug,
        next,
        body.reason
      )
      if (!updated) {
        set.status = 404
        return { success: false, error: 'Tenant not found' }
      }
      return { success: true, data: updated }
    },
    {
      beforeHandle: [guardSuperAdmin],
      body: t.Object({
        status: t.Union([t.Literal('ACTIVE'), t.Literal('SUSPENDED'), t.Literal('ARCHIVED')]),
        reason: t.Optional(t.String({ maxLength: 500 })),
      }),
    }
  )

  // ── DELETE /superadmin/tenants/:slug ───────────────────────────────────────
  .delete(
    '/tenants/:slug',
    async ({ params, user, set }) => {
      if (!user) {
        set.status = 401
        return { success: false, error: 'Unauthorized' }
      }
      const updated = await changeTenantStatus(
        publicDb,
        env.DATABASE_URL,
        user.userId,
        params.slug,
        'ARCHIVED'
      )
      if (!updated) {
        set.status = 404
        return { success: false, error: 'Tenant not found' }
      }
      return { success: true, data: updated }
    },
    { beforeHandle: [guardSuperAdmin] }
  )

  // ── POST /superadmin/tenants/:slug/admin/reset ─────────────────────────────
  .post(
    '/tenants/:slug/admin/reset',
    async ({ params, body, user, set }) => {
      if (!user) {
        set.status = 401
        return { success: false, error: 'Unauthorized' }
      }
      const tenant = await findTenantBySlug(publicDb, params.slug)
      if (!tenant) {
        set.status = 404
        return { success: false, error: 'Tenant not found' }
      }
      const passwordHash = await hashPassword(body.password)
      const result = await resetTenantAdminPassword(env.DATABASE_URL, params.slug, passwordHash)
      if (!result) {
        set.status = 404
        return { success: false, error: 'Tenant has no admin user yet' }
      }
      return { success: true, data: { email: result.email } }
    },
    {
      beforeHandle: [guardSuperAdmin],
      body: t.Object({
        password: t.String({ minLength: 12, maxLength: 256 }),
      }),
    }
  )

  // ── GET /superadmin/permissions ────────────────────────────────────────────
  .get(
    '/permissions',
    async () => ({ success: true, data: await listPermissionsCatalog(publicDb) }),
    { beforeHandle: [guardSuperAdmin] }
  )

  // ── GET /superadmin/audit ──────────────────────────────────────────────────
  .get(
    '/audit',
    async ({ query }) => {
      const limit = query.limit ? Number.parseInt(query.limit, 10) : undefined
      const data = await listSuperAdminAudit(publicDb, {
        tenantId: query.tenantId,
        action: query.action,
        limit: Number.isFinite(limit) ? limit : undefined,
      })
      return { success: true, data }
    },
    {
      beforeHandle: [guardSuperAdmin],
      query: t.Object({
        tenantId: t.Optional(t.String()),
        action: t.Optional(t.String({ maxLength: 80 })),
        limit: t.Optional(t.String()),
      }),
    }
  )
