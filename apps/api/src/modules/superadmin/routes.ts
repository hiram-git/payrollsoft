import { superAdminAudit } from '@payroll/db'
import { validateTenantSlug } from '@payroll/utils'
import { Elysia, t } from 'elysia'
import { publicDb } from '../../config/db'
import { env } from '../../config/env'
import { hashPassword } from '../../lib/password'
import { authPlugin, guardSuperAdmin } from '../../middleware/auth'
import { jwtPlugin } from '../../middleware/auth'
import {
  buildImpersonationPayload,
  changeTenantStatus,
  createTenant,
  findTenantBySlug,
  getPlatformMetrics,
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
  .use(jwtPlugin)

  // ── POST /superadmin/tenants/:slug/impersonate ────────────────────────────
  // Mints a short-lived (30 min) JWT representing the tenant_admin of `slug`
  // and tags it with impersonatedBy so the UI surfaces a permanent banner
  // and audit_log captures every action under the original super-admin's
  // identity.
  .post('/tenants/:slug/impersonate', async ({ params, user, jwt, set }) => {
    if (!user || user.type !== 'super_admin') {
      set.status = 403
      return { success: false, error: 'Forbidden: super admin only' }
    }

    const tenant = await findTenantBySlug(publicDb, params.slug)
    if (!tenant) {
      set.status = 404
      return { success: false, error: 'Tenant not found' }
    }
    if (tenant.status !== 'ACTIVE') {
      set.status = 409
      return { success: false, error: `Tenant is ${tenant.status}` }
    }

    const payload = await buildImpersonationPayload(env.DATABASE_URL, params.slug, {
      id: user.userId,
      email: user.email ?? null,
    })
    if (!payload) {
      set.status = 404
      return { success: false, error: 'Tenant has no admin user yet' }
    }

    // 30-minute session — long enough to do real work, short enough that
    // a forgotten tab won't keep the elevated identity alive forever.
    const token = await jwt.sign({ ...payload, exp: Math.floor(Date.now() / 1000) + 30 * 60 })

    await publicDb.insert(superAdminAudit).values({
      superAdminId: user.userId,
      tenantId: tenant.id,
      action: 'tenant.impersonate',
      payload: { adminUserId: payload.userId, ttlMinutes: 30 },
    })

    return {
      success: true,
      data: { token, tenantSlug: params.slug, expiresInSeconds: 30 * 60 },
    }
  })

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
        log: (line) => console.log(`[provision ${body.slug}] ${line}`),
      })

      if (!result.ok) {
        console.error(`[provision ${body.slug}] failed`, result.error)
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

  // ── GET /superadmin/metrics ────────────────────────────────────────────────
  // Snapshot for the super-admin dashboard and external probes.
  .get('/metrics', async () => ({ success: true, data: await getPlatformMetrics(publicDb) }), {
    beforeHandle: [guardSuperAdmin],
  })

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
