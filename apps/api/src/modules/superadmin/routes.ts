import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { applySeedToTenant, superAdminAudit } from '@payroll/db'
import { validateTenantSlug } from '@payroll/utils'
import { Elysia, t } from 'elysia'
import { publicDb } from '../../config/db'
import { env } from '../../config/env'

/**
 * Locate packages/db/drizzle/tenant for the provisioning service.
 * `provisionTenant` defaults to a path resolved via `import.meta.url`,
 * which works from source but breaks once Bun bundles the API (the
 * bundle's URL is apps/api/dist/... so the default points at
 * apps/api/drizzle, which does not exist in the deploy image).
 *
 * Resolution order:
 *   1. TENANT_MIGRATIONS_DIR env var (explicit override).
 *   2. Common Railway/monorepo paths walked from cwd: the API is
 *      typically launched from /app/apps/api, so packages/db lives
 *      two directories up.
 *   3. undefined → let provisionTenant fall back to its in-package
 *      default (correct in dev / unbundled runs).
 */
function resolveTenantMigrationsFolder(): string | undefined {
  if (env.TENANT_MIGRATIONS_DIR) return env.TENANT_MIGRATIONS_DIR
  const cwd = process.cwd()
  const candidates = [
    resolve(cwd, 'packages/db/drizzle/tenant'),
    resolve(cwd, '../../packages/db/drizzle/tenant'),
    resolve(cwd, '../packages/db/drizzle/tenant'),
    '/app/packages/db/drizzle/tenant',
  ]
  for (const candidate of candidates) {
    if (existsSync(resolve(candidate, 'meta', '_journal.json'))) return candidate
  }
  return undefined
}

const TENANT_MIGRATIONS_FOLDER = resolveTenantMigrationsFolder()
if (TENANT_MIGRATIONS_FOLDER) {
  console.log(`[provisioning] tenant migrations dir: ${TENANT_MIGRATIONS_FOLDER}`)
} else if (env.NODE_ENV === 'production') {
  console.warn(
    '[provisioning] TENANT_MIGRATIONS_DIR not set and no candidate found. ' +
      'Tenant creation will fail in this deploy.'
  )
}
import { hashPassword } from '../../lib/password'
import { authPlugin, guardSuperAdmin } from '../../middleware/auth'
import { jwtPlugin } from '../../middleware/auth'
import {
  buildImpersonationPayload,
  changeTenantStatus,
  createPermission,
  createSystemRole,
  createTenant,
  findTenantBySlug,
  getPlatformMetrics,
  getProvisioningStatus,
  listPermissionsCatalog,
  listSuperAdminAudit,
  listSystemRoles,
  listTenants,
  propagateSystemRoleToAllTenants,
  resetTenantAdminPassword,
  setSystemRolePermissions,
  updatePermission,
  updateSystemRole,
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
        institutionType: body.institutionType === 'publica' ? 'publica' : 'privada',
        admin: {
          email: body.adminEmail,
          name: body.adminName,
          passwordHash,
        },
        superAdminId: user?.userId,
        tenantMigrationsFolder: TENANT_MIGRATIONS_FOLDER,
        log: (line) => console.log(`[provision ${body.slug}] ${line}`),
        seeds: body.seeds,
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
        institutionType: t.Optional(
          t.Union([t.Literal('publica'), t.Literal('privada')])
        ),
        seeds: t.Optional(
          t.Object({
            employees: t.Optional(t.Boolean()),
            loans: t.Optional(t.Boolean()),
            employeesTotal: t.Optional(t.Integer({ minimum: 1, maximum: 10000 })),
          })
        ),
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

  // ── POST /superadmin/tenants/:slug/seeds/:code ─────────────────────────────
  // Aplica un seed (employees | loans) sobre un tenant existente. La
  // marca `metadata.seeds.<code>.applied_at` evita reaplicaciones desde
  // la UI; revertir requiere intervención directa en BD.
  .post(
    '/tenants/:slug/seeds/:code',
    async ({ params, body, user, set }) => {
      if (!user) {
        set.status = 401
        return { success: false, error: 'Unauthorized' }
      }
      if (params.code !== 'employees' && params.code !== 'loans') {
        set.status = 400
        return { success: false, error: 'Seed inválido. Usa employees o loans.' }
      }
      const result = await applySeedToTenant(env.DATABASE_URL, params.slug, params.code, {
        superAdminId: user.userId,
        employeesTotal: body?.employeesTotal,
        log: (line) => console.log(`[seed ${params.slug}/${params.code}] ${line}`),
      })
      if (!result.ok) {
        set.status =
          result.error === 'tenant_not_found' ? 404 : result.error === 'already_applied' ? 409 : 500
        return {
          success: false,
          error: result.error,
          message: result.message,
        }
      }
      return { success: true, data: result }
    },
    {
      beforeHandle: [guardSuperAdmin],
      body: t.Optional(
        t.Object({
          employeesTotal: t.Optional(t.Integer({ minimum: 1, maximum: 10000 })),
        })
      ),
    }
  )

  // ── GET /superadmin/permissions ────────────────────────────────────────────
  .get(
    '/permissions',
    async () => ({ success: true, data: await listPermissionsCatalog(publicDb) }),
    { beforeHandle: [guardSuperAdmin] }
  )

  // ── POST /superadmin/permissions ───────────────────────────────────────────
  // Crea un permiso nuevo en el catálogo global. Inmediatamente
  // disponible para asignar a cualquier rol (no necesita propagación).
  .post(
    '/permissions',
    async ({ body, user, set }) => {
      const result = await createPermission(publicDb, body)
      if (!result.ok) {
        set.status = 422
        return { success: false, error: result.error }
      }
      await publicDb.insert(superAdminAudit).values({
        superAdminId: user?.userId ?? null,
        action: 'permission.create',
        payload: { code: body.code, module: body.module },
      })
      set.status = 201
      return { success: true, data: { code: result.code } }
    },
    {
      beforeHandle: [guardSuperAdmin],
      body: t.Object({
        code: t.String({ minLength: 3, maxLength: 80 }),
        module: t.String({ minLength: 1, maxLength: 40 }),
        action: t.String({ minLength: 1, maxLength: 40 }),
        scope: t.Optional(t.Union([t.Literal('tenant'), t.Literal('global')])),
        description: t.String({ minLength: 1, maxLength: 500 }),
        isDangerous: t.Optional(t.Boolean()),
      }),
    }
  )

  // ── PUT /superadmin/permissions/:code ──────────────────────────────────────
  .put(
    '/permissions/:code',
    async ({ params, body, user, set }) => {
      const ok = await updatePermission(publicDb, params.code, body)
      if (!ok) {
        set.status = 404
        return { success: false, error: 'Permiso no encontrado' }
      }
      await publicDb.insert(superAdminAudit).values({
        superAdminId: user?.userId ?? null,
        action: 'permission.update',
        payload: { code: params.code, changes: body },
      })
      return { success: true }
    },
    {
      beforeHandle: [guardSuperAdmin],
      params: t.Object({ code: t.String() }),
      body: t.Object({
        description: t.Optional(t.String({ minLength: 1, maxLength: 500 })),
        isDangerous: t.Optional(t.Boolean()),
        scope: t.Optional(t.Union([t.Literal('tenant'), t.Literal('global')])),
      }),
    }
  )

  // ── GET /superadmin/system-roles ───────────────────────────────────────────
  // Roles del catálogo global con sus permisos. Estos son los que se
  // propagan a cada tenant.
  .get('/system-roles', async () => ({ success: true, data: await listSystemRoles(publicDb) }), {
    beforeHandle: [guardSuperAdmin],
  })

  // ── POST /superadmin/system-roles ──────────────────────────────────────────
  .post(
    '/system-roles',
    async ({ body, user, set }) => {
      const result = await createSystemRole(publicDb, body)
      if (!result.ok) {
        set.status = 422
        return { success: false, error: result.error }
      }
      await publicDb.insert(superAdminAudit).values({
        superAdminId: user?.userId ?? null,
        action: 'system_role.create',
        payload: { code: body.code },
      })
      set.status = 201
      return { success: true }
    },
    {
      beforeHandle: [guardSuperAdmin],
      body: t.Object({
        code: t.String({ minLength: 2, maxLength: 50 }),
        name: t.String({ minLength: 1, maxLength: 120 }),
        description: t.Optional(t.Nullable(t.String({ maxLength: 1000 }))),
        isDangerous: t.Optional(t.Boolean()),
      }),
    }
  )

  // ── PUT /superadmin/system-roles/:code ─────────────────────────────────────
  .put(
    '/system-roles/:code',
    async ({ params, body, user, set }) => {
      const ok = await updateSystemRole(publicDb, params.code, body)
      if (!ok) {
        set.status = 404
        return { success: false, error: 'Rol no encontrado' }
      }
      await publicDb.insert(superAdminAudit).values({
        superAdminId: user?.userId ?? null,
        action: 'system_role.update',
        payload: { code: params.code, changes: body },
      })
      return { success: true }
    },
    {
      beforeHandle: [guardSuperAdmin],
      params: t.Object({ code: t.String() }),
      body: t.Object({
        name: t.Optional(t.String({ minLength: 1, maxLength: 120 })),
        description: t.Optional(t.Nullable(t.String({ maxLength: 1000 }))),
        isDangerous: t.Optional(t.Boolean()),
      }),
    }
  )

  // ── PUT /superadmin/system-roles/:code/permissions ─────────────────────────
  // Reemplaza el set completo de permisos asignados al rol.
  .put(
    '/system-roles/:code/permissions',
    async ({ params, body, user, set }) => {
      const ok = await setSystemRolePermissions(publicDb, params.code, body.permissions)
      if (!ok) {
        set.status = 404
        return { success: false, error: 'Rol no encontrado' }
      }
      await publicDb.insert(superAdminAudit).values({
        superAdminId: user?.userId ?? null,
        action: 'system_role.permissions',
        payload: { code: params.code, count: body.permissions.length },
      })
      return { success: true }
    },
    {
      beforeHandle: [guardSuperAdmin],
      params: t.Object({ code: t.String() }),
      body: t.Object({
        permissions: t.Array(t.String({ maxLength: 80 })),
      }),
    }
  )

  // ── POST /superadmin/system-roles/:code/propagate ──────────────────────────
  // Aplica el rol + sus permisos a TODOS los tenants. Idempotente.
  .post(
    '/system-roles/:code/propagate',
    async ({ params, user, set }) => {
      const result = await propagateSystemRoleToAllTenants(publicDb, env.DATABASE_URL, params.code)
      await publicDb.insert(superAdminAudit).values({
        superAdminId: user?.userId ?? null,
        action: 'system_role.propagate',
        payload: {
          code: params.code,
          applied: result.applied.length,
          errors: result.errors.length,
        },
      })
      if (!result.ok && result.applied.length === 0) {
        set.status = 422
        return { success: false, error: result.errors[0]?.error ?? 'Falló la propagación' }
      }
      return { success: true, data: result }
    },
    {
      beforeHandle: [guardSuperAdmin],
      params: t.Object({ code: t.String() }),
    }
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
