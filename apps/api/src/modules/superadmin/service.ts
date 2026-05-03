import {
  type ProvisionTenantInput,
  type ProvisionTenantResult,
  permissionsCatalog,
  provisionTenant,
  superAdminAudit,
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
