import {
  type ProvisionTenantInput,
  type ProvisionTenantResult,
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
import { eq } from 'drizzle-orm'
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
