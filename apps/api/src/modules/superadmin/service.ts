import {
  type ProvisionTenantInput,
  type ProvisionTenantResult,
  permissionsCatalog,
  provisionTenant,
  superAdminAudit,
  systemRolePermissions,
  systemRolesCatalog,
  tenantProvisioning,
  tenants,
} from '@payroll/db'
/**
 * Service layer for super-admin tenant management.
 *
 * Wraps the @payroll/db provisioning service plus the lifecycle queries
 * (list, suspend, reactivate, archive). Routes stay thin and just translate
 * service results into HTTP responses.
 */
import { desc, eq, sql } from 'drizzle-orm'
import postgres from 'postgres'

// biome-ignore lint/suspicious/noExplicitAny: Drizzle generic
type AnyDb = any

export type TenantSummary = {
  id: string
  slug: string
  name: string
  status: string
  databaseSchema: string
  contactEmail: string | null
  createdAt: Date
  updatedAt: Date
  archivedAt: Date | null
}

export async function listTenants(db: AnyDb): Promise<TenantSummary[]> {
  return db.select().from(tenants).orderBy(tenants.slug)
}

export async function findTenantBySlug(db: AnyDb, slug: string): Promise<TenantSummary | null> {
  const [row] = await db.select().from(tenants).where(eq(tenants.slug, slug)).limit(1)
  return row ?? null
}

export async function getProvisioningStatus(db: AnyDb, tenantId: string) {
  const [row] = await db
    .select()
    .from(tenantProvisioning)
    .where(eq(tenantProvisioning.tenantId, tenantId))
    .limit(1)
  return row ?? null
}

export async function createTenant(
  databaseUrl: string,
  input: ProvisionTenantInput
): Promise<ProvisionTenantResult> {
  return provisionTenant(databaseUrl, input)
}

export type TenantStatusChange = 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED'

export async function changeTenantStatus(
  db: AnyDb,
  databaseUrl: string,
  superAdminId: string,
  slug: string,
  next: TenantStatusChange,
  reason?: string
): Promise<TenantSummary | null> {
  const tenant = await findTenantBySlug(db, slug)
  if (!tenant) return null

  const archivedAt = next === 'ARCHIVED' ? new Date() : null
  const isActive = next === 'ACTIVE'

  const [updated] = await db
    .update(tenants)
    .set({
      status: next,
      isActive,
      archivedAt,
      updatedAt: new Date(),
    })
    .where(eq(tenants.id, tenant.id))
    .returning()

  await db.insert(superAdminAudit).values({
    superAdminId,
    tenantId: tenant.id,
    action: `tenant.${next.toLowerCase()}`,
    payload: reason ? { reason } : {},
  })

  // Status changes never need to touch the tenant schema, but we surface a
  // hook for future work (e.g. closing all sessions on suspend).
  void databaseUrl

  return updated
}

/**
 * Build an AuthUser payload representing the tenant_admin of `slug` acting
 * under super-admin impersonation. Returns null when the tenant has no admin
 * user yet.
 *
 * Effective permissions are resolved against the tenant's roles graph via
 * the same recursive CTE used at login, so the impersonating super-admin
 * gets exactly what the tenant_admin would have.
 */
export async function buildImpersonationPayload(
  databaseUrl: string,
  slug: string,
  superAdmin: { id: string; email: string | null }
): Promise<{
  userId: string
  tenantId: string
  tenantSlug: string
  role: 'ADMIN'
  type: 'user'
  name: string
  email: string
  permissions: string[]
  permissionsVersion: number
  impersonatedBy: { superAdminId: string; superAdminEmail?: string }
} | null> {
  const sqlc = postgres(databaseUrl, {
    prepare: false,
    connection: { search_path: `tenant_${slug},payroll_auth,public` },
    onnotice: () => {},
  })
  try {
    const [admin] = await sqlc<
      { id: string; email: string; name: string; permissions_version: number }[]
    >`
      SELECT id, email, name, permissions_version
        FROM users
       WHERE is_tenant_admin = true AND is_active = true
       LIMIT 1
    `
    if (!admin) return null

    const rows = await sqlc<{ permissions: string[] | null }[]>`
      WITH RECURSIVE
        direct AS (
          SELECT ur.role_id, 0 AS depth
            FROM user_roles ur
           WHERE ur.user_id = ${admin.id}::uuid
        ),
        closure AS (
          SELECT role_id, depth FROM direct
          UNION
          SELECT ri.parent_role_id, c.depth + 1
            FROM role_inheritance ri
            JOIN closure c ON ri.child_role_id = c.role_id
           WHERE c.depth < 10
        )
      SELECT (
        SELECT array_agg(DISTINCT rp.permission_code)
          FROM closure c
          JOIN role_permissions rp ON rp.role_id = c.role_id
      ) AS permissions
    `

    const permissions = rows[0]?.permissions ?? []

    return {
      userId: admin.id,
      tenantId: slug,
      tenantSlug: slug,
      role: 'ADMIN',
      type: 'user',
      name: admin.name,
      email: admin.email,
      permissions,
      permissionsVersion: admin.permissions_version,
      impersonatedBy: {
        superAdminId: superAdmin.id,
        superAdminEmail: superAdmin.email ?? undefined,
      },
    }
  } finally {
    await sqlc.end()
  }
}

/**
 * Reset the password of the tenant admin. Returns the new admin user id, or
 * null if the tenant does not exist or has no admin yet.
 */
export async function resetTenantAdminPassword(
  databaseUrl: string,
  slug: string,
  newPasswordHash: string
): Promise<{ adminUserId: string; email: string } | null> {
  const sql = postgres(databaseUrl, {
    prepare: false,
    connection: { search_path: `tenant_${slug},payroll_auth,public` },
    onnotice: () => {},
  })
  try {
    const [row] = await sql<{ id: string; email: string }[]>`
      UPDATE users
         SET password_hash       = ${newPasswordHash},
             permissions_version = permissions_version + 1,
             updated_at          = now()
       WHERE is_tenant_admin = true
       RETURNING id, email
    `
    if (!row) return null
    return { adminUserId: row.id, email: row.email }
  } finally {
    await sql.end()
  }
}

/**
 * Read the master permissions catalog. Used by the super-admin UI to render
 * the permission tree without baking it into the bundle.
 */
export async function listPermissionsCatalog(db: AnyDb) {
  return db.select().from(permissionsCatalog).orderBy(permissionsCatalog.module)
}

// ─── Permissions catalog CRUD (super-admin only) ─────────────────────────

const PERMISSION_CODE_RE = /^[a-z][a-z_]{1,38}:[a-z][a-z_0-9.]{1,38}$/

/**
 * Crea un permiso nuevo en el catálogo global. El `code` debe seguir
 * la convención `<module>:<action>[.<sub>]` validada por el CHECK
 * constraint en la migración 0002 y replicada aquí para mejores
 * mensajes de error.
 */
export async function createPermission(
  db: AnyDb,
  input: {
    code: string
    module: string
    action: string
    scope?: 'tenant' | 'global'
    description: string
    isDangerous?: boolean
  }
): Promise<{ ok: true; code: string } | { ok: false; error: string }> {
  if (!PERMISSION_CODE_RE.test(input.code)) {
    return { ok: false, error: 'Código inválido. Usa "modulo:accion" en snake_case.' }
  }
  const [parsedModule, parsedAction] = input.code.split(':')
  if (input.module !== parsedModule) {
    return {
      ok: false,
      error: `El módulo "${input.module}" no coincide con el code "${input.code}".`,
    }
  }
  if (input.action !== parsedAction.split('.')[0]) {
    return {
      ok: false,
      error: `La acción "${input.action}" no coincide con el code "${input.code}".`,
    }
  }
  try {
    await db
      .insert(permissionsCatalog)
      .values({
        code: input.code,
        module: input.module,
        action: input.action,
        scope: input.scope ?? 'tenant',
        description: input.description.trim(),
        isDangerous: input.isDangerous ?? false,
      })
      .onConflictDoNothing()
    return { ok: true, code: input.code }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'No se pudo crear el permiso.' }
  }
}

/**
 * Edita la descripción o el flag isDangerous de un permiso existente.
 * El `code`, `module` y `action` son inmutables porque podrían estar
 * referenciados en role_permissions de cada tenant.
 */
export async function updatePermission(
  db: AnyDb,
  code: string,
  patch: { description?: string; isDangerous?: boolean; scope?: 'tenant' | 'global' }
): Promise<boolean> {
  const set: Record<string, unknown> = {}
  if (patch.description != null) set.description = patch.description.trim()
  if (patch.isDangerous != null) set.isDangerous = patch.isDangerous
  if (patch.scope != null) set.scope = patch.scope
  if (Object.keys(set).length === 0) return true
  const res = await db
    .update(permissionsCatalog)
    .set(set)
    .where(eq(permissionsCatalog.code, code))
    .returning()
  return res.length > 0
}

// ─── System roles catalog (super-admin only) ─────────────────────────────

export type SystemRoleWithPermissions = {
  code: string
  name: string
  description: string | null
  isDangerous: boolean
  permissions: string[]
}

export async function listSystemRoles(db: AnyDb): Promise<SystemRoleWithPermissions[]> {
  const roles = await db.select().from(systemRolesCatalog).orderBy(systemRolesCatalog.code)
  const perms = await db.select().from(systemRolePermissions)
  const byRole = new Map<string, string[]>()
  for (const p of perms as Array<{ roleCode: string; permissionCode: string }>) {
    const arr = byRole.get(p.roleCode) ?? []
    arr.push(p.permissionCode)
    byRole.set(p.roleCode, arr)
  }
  return (
    roles as Array<{
      code: string
      name: string
      description: string | null
      isDangerous: boolean
    }>
  ).map((r) => ({
    code: r.code,
    name: r.name,
    description: r.description,
    isDangerous: r.isDangerous,
    permissions: (byRole.get(r.code) ?? []).sort(),
  }))
}

const ROLE_CODE_RE = /^[a-z][a-z0-9_]{1,49}$/

export async function createSystemRole(
  db: AnyDb,
  input: { code: string; name: string; description?: string | null; isDangerous?: boolean }
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!ROLE_CODE_RE.test(input.code)) {
    return { ok: false, error: 'Código inválido. Usa snake_case, hasta 50 caracteres.' }
  }
  try {
    await db
      .insert(systemRolesCatalog)
      .values({
        code: input.code,
        name: input.name.trim(),
        description: input.description ?? null,
        isDangerous: input.isDangerous ?? false,
      })
      .onConflictDoNothing()
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'No se pudo crear el rol.' }
  }
}

export async function updateSystemRole(
  db: AnyDb,
  code: string,
  patch: { name?: string; description?: string | null; isDangerous?: boolean }
): Promise<boolean> {
  const set: Record<string, unknown> = { updatedAt: new Date() }
  if (patch.name != null) set.name = patch.name.trim()
  if (patch.description !== undefined) set.description = patch.description
  if (patch.isDangerous != null) set.isDangerous = patch.isDangerous
  const res = await db
    .update(systemRolesCatalog)
    .set(set)
    .where(eq(systemRolesCatalog.code, code))
    .returning()
  return res.length > 0
}

/**
 * Reemplaza el set completo de permisos asignados al rol global.
 * Es la operación que dispara la propagación a tenants.
 */
export async function setSystemRolePermissions(
  db: AnyDb,
  code: string,
  permissionCodes: string[]
): Promise<boolean> {
  const [exists] = await db
    .select()
    .from(systemRolesCatalog)
    .where(eq(systemRolesCatalog.code, code))
    .limit(1)
  if (!exists) return false
  await db.delete(systemRolePermissions).where(eq(systemRolePermissions.roleCode, code))
  if (permissionCodes.length > 0) {
    const rows = permissionCodes.map((permissionCode) => ({ roleCode: code, permissionCode }))
    await db.insert(systemRolePermissions).values(rows).onConflictDoNothing()
  }
  return true
}

/**
 * Propaga un rol global a todos los tenants activos.
 *
 *   1. UPSERT en `roles` por code (preserva is_system=true).
 *   2. DELETE + INSERT en `role_permissions` para mantener el rol en
 *      lockstep con el catálogo global.
 *   3. Cualquier tenant que falle no detiene a los demás — se
 *      reporta en el resultado.
 *
 * No toca `user_roles` (las asignaciones se preservan) ni los roles
 * custom que el tenant haya creado por su cuenta.
 */
export type PropagationResult = {
  ok: boolean
  applied: { slug: string; created: boolean }[]
  errors: { slug: string; error: string }[]
}

export async function propagateSystemRoleToAllTenants(
  publicDbInst: AnyDb,
  databaseUrl: string,
  code: string
): Promise<PropagationResult> {
  const [role] = await publicDbInst
    .select()
    .from(systemRolesCatalog)
    .where(eq(systemRolesCatalog.code, code))
    .limit(1)
  if (!role) return { ok: false, applied: [], errors: [{ slug: '_', error: 'Rol no encontrado' }] }

  const perms = await publicDbInst
    .select({ permissionCode: systemRolePermissions.permissionCode })
    .from(systemRolePermissions)
    .where(eq(systemRolePermissions.roleCode, code))
  const permissionCodes = (perms as Array<{ permissionCode: string }>).map((p) => p.permissionCode)

  const allTenants: TenantSummary[] = await listTenants(publicDbInst)
  const targetTenants = allTenants.filter((t) => t.status === 'ACTIVE' || t.status === 'SUSPENDED')

  const applied: { slug: string; created: boolean }[] = []
  const errors: { slug: string; error: string }[] = []

  for (const tenant of targetTenants) {
    const sqlc = postgres(databaseUrl, {
      prepare: false,
      connection: { search_path: `tenant_${tenant.slug},payroll_auth,public` },
      onnotice: () => {},
    })
    try {
      const upsertRows = await sqlc<{ id: string; created: boolean }[]>`
        INSERT INTO roles (code, name, description, is_system)
        VALUES (${role.code}, ${role.name}, ${role.description}, true)
        ON CONFLICT (code) DO UPDATE
          SET name        = EXCLUDED.name,
              description = EXCLUDED.description,
              is_system   = true,
              updated_at  = now()
        RETURNING id, (xmax = 0) AS created
      `
      const roleId = upsertRows[0].id
      const created = upsertRows[0].created === true

      await sqlc`DELETE FROM role_permissions WHERE role_id = ${roleId}`
      if (permissionCodes.length > 0) {
        const rows = permissionCodes.map((permCode) => ({
          role_id: roleId,
          permission_code: permCode,
        }))
        await sqlc`
          INSERT INTO role_permissions ${sqlc(rows, 'role_id', 'permission_code')}
          ON CONFLICT DO NOTHING
        `
      }
      // Bump permissions_version de cualquier user que tenga el rol
      // para invalidar sus JWTs en el próximo refresh.
      await sqlc`
        UPDATE users
           SET permissions_version = permissions_version + 1,
               updated_at = now()
         WHERE id IN (SELECT user_id FROM user_roles WHERE role_id = ${roleId})
      `
      applied.push({ slug: tenant.slug, created })
    } catch (err) {
      errors.push({
        slug: tenant.slug,
        error: err instanceof Error ? err.message : String(err),
      })
    } finally {
      await sqlc.end()
    }
  }

  return { ok: errors.length === 0, applied, errors }
}

export type AuditFilters = {
  tenantId?: string
  action?: string
  limit?: number
}

/**
 * Cross-tenant audit feed. Optional filters narrow by tenant or action; the
 * default page size of 100 keeps responses bounded.
 */
export async function listSuperAdminAudit(db: AnyDb, filters: AuditFilters = {}) {
  const limit = Math.min(Math.max(filters.limit ?? 100, 1), 500)
  let query = db.select().from(superAdminAudit).orderBy(desc(superAdminAudit.createdAt))
  if (filters.tenantId) {
    query = query.where(eq(superAdminAudit.tenantId, filters.tenantId))
  } else if (filters.action) {
    query = query.where(eq(superAdminAudit.action, filters.action))
  }
  return query.limit(limit)
}

/**
 * Operational metrics for the super-admin dashboard / external monitors.
 *
 * Returns counts by tenant status plus the most recent provisioning
 * failures so an on-call engineer can spot stuck schemas without trawling
 * the audit feed.
 */
export type PlatformMetrics = {
  tenantCounts: {
    total: number
    active: number
    provisioning: number
    suspended: number
    archived: number
  }
  failedProvisionings: Array<{
    tenantId: string
    state: string
    error: string | null
    finishedAt: Date | null
  }>
}

export async function getPlatformMetrics(db: AnyDb): Promise<PlatformMetrics> {
  const [counts] = await db
    .select({
      total: sql<number>`count(*)::int`,
      active: sql<number>`count(*) filter (where ${tenants.status} = 'ACTIVE')::int`,
      provisioning: sql<number>`count(*) filter (where ${tenants.status} = 'PROVISIONING')::int`,
      suspended: sql<number>`count(*) filter (where ${tenants.status} = 'SUSPENDED')::int`,
      archived: sql<number>`count(*) filter (where ${tenants.status} = 'ARCHIVED')::int`,
    })
    .from(tenants)

  const failed = await db
    .select({
      tenantId: tenantProvisioning.tenantId,
      state: tenantProvisioning.state,
      error: tenantProvisioning.error,
      finishedAt: tenantProvisioning.finishedAt,
    })
    .from(tenantProvisioning)
    .where(eq(tenantProvisioning.state, 'failed'))
    .orderBy(desc(tenantProvisioning.finishedAt))
    .limit(20)

  return {
    tenantCounts: counts ?? { total: 0, active: 0, provisioning: 0, suspended: 0, archived: 0 },
    failedProvisionings: failed,
  }
}
