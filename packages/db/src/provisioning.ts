/**
 * Tenant provisioning service.
 *
 * Orchestrates the full lifecycle of "create a new company" from the central
 * payroll_auth schema:
 *
 *   1. Insert the tenant row in payroll_auth.tenants with status=PROVISIONING
 *      and a matching tenant_provisioning row in state=running.
 *   2. CREATE SCHEMA tenant_<slug> and apply every Drizzle migration from
 *      drizzle/tenant against the new schema.
 *   3. Seed the four system roles (tenant_admin, hr, accountant, viewer)
 *      and their default permission grants.
 *   4. Create the single tenant admin user, mark is_tenant_admin=true and
 *      assign them the tenant_admin role.
 *   5. Flip the tenant to status=ACTIVE and tenant_provisioning to done.
 *
 * On any failure we attempt to drop the half-built schema and persist the
 * error so the super-admin UI can surface it. The caller decides whether
 * to delete the tenant row or leave it as PROVISIONING/failed for retry.
 */
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SYSTEM_ROLES, type SystemRoleCode } from '@payroll/types'
import { tenantSchemaName, validateTenantSlug } from '@payroll/utils'
import postgres from 'postgres'
import { runMigrations } from './migrator'

export type ProvisionTenantInput = {
  slug: string
  name: string
  contactEmail?: string | null
  admin: {
    email: string
    name: string
    /** Pre-hashed password — the API hashes with bcrypt before calling. */
    passwordHash: string
  }
  /** Optional: identify the super-admin who triggered the provisioning. */
  superAdminId?: string
  /** Override path to the tenant migrations folder (used in tests). */
  tenantMigrationsFolder?: string
  /** Sink for progress logs. Defaults to console.log. */
  log?: (line: string) => void
}

export type ProvisionedTenant = {
  tenantId: string
  slug: string
  schemaName: string
  adminUserId: string
}

export type ProvisionTenantError =
  | { kind: 'invalid_slug'; message: string }
  | { kind: 'slug_taken' }
  | { kind: 'admin_email_invalid' }
  | { kind: 'provisioning_failed'; message: string }

export type ProvisionTenantResult =
  | { ok: true; tenant: ProvisionedTenant }
  | { ok: false; error: ProvisionTenantError }

const HERE = dirname(fileURLToPath(import.meta.url))
const DEFAULT_TENANT_MIGRATIONS = resolve(HERE, '..', 'drizzle', 'tenant')

export async function provisionTenant(
  databaseUrl: string,
  input: ProvisionTenantInput
): Promise<ProvisionTenantResult> {
  const slugCheck = validateTenantSlug(input.slug)
  if (!slugCheck.ok) {
    return { ok: false, error: { kind: 'invalid_slug', message: slugCheck.message } }
  }
  const slug = slugCheck.slug
  const schemaName = tenantSchemaName(slug)

  if (!input.admin.email || !input.admin.email.includes('@')) {
    return { ok: false, error: { kind: 'admin_email_invalid' } }
  }

  const log = input.log ?? (() => {})
  const folder = input.tenantMigrationsFolder ?? DEFAULT_TENANT_MIGRATIONS

  // Central client (payroll_auth) — used for tenant + provisioning bookkeeping.
  const central = postgres(databaseUrl, {
    prepare: false,
    connection: { search_path: 'payroll_auth,public' },
    onnotice: () => {},
  })

  let tenantId: string | null = null
  let createdSchema = false

  try {
    // Reject early if the slug is already in use — saves us creating any rows.
    const existing = await central<{ id: string }[]>`
      SELECT id FROM payroll_auth.tenants WHERE slug = ${slug} LIMIT 1
    `
    if (existing.length > 0) {
      await central.end()
      return { ok: false, error: { kind: 'slug_taken' } }
    }

    const inserted = await central<{ id: string }[]>`
      INSERT INTO payroll_auth.tenants (slug, name, database_schema, status, contact_email)
      VALUES (${slug}, ${input.name}, ${schemaName}, 'PROVISIONING', ${input.contactEmail ?? null})
      RETURNING id
    `
    tenantId = inserted[0].id

    await central`
      INSERT INTO payroll_auth.tenant_provisioning (tenant_id, state, started_at)
      VALUES (${tenantId}, 'running', now())
      ON CONFLICT (tenant_id) DO UPDATE
        SET state = 'running', started_at = now(), error = NULL, finished_at = NULL
    `

    // Now switch to a tenant-scoped client to build the new schema.
    const tenant = postgres(databaseUrl, {
      prepare: false,
      connection: { search_path: `${schemaName},payroll_auth,public` },
      onnotice: () => {},
    })

    let adminUserId: string
    try {
      await tenant`CREATE SCHEMA IF NOT EXISTS ${tenant(schemaName)}`
      createdSchema = true
      log(`  schema ${schemaName} created`)

      await runMigrations(tenant, { folder, schemaLabel: schemaName, log })

      adminUserId = await seedTenantBootstrapData(tenant, input.admin)
      await seedCompanyConfig(tenant, {
        companyName: input.name,
        contactEmail: input.contactEmail ?? null,
      })
    } finally {
      await tenant.end()
    }

    await central`
      UPDATE payroll_auth.tenants
         SET status = 'ACTIVE', updated_at = now()
       WHERE id = ${tenantId}
    `
    await central`
      UPDATE payroll_auth.tenant_provisioning
         SET state = 'done', finished_at = now(), error = NULL
       WHERE tenant_id = ${tenantId}
    `

    if (input.superAdminId) {
      await central`
        INSERT INTO payroll_auth.super_admin_audit (super_admin_id, tenant_id, action, payload)
        VALUES (${input.superAdminId}, ${tenantId}, 'tenant.create',
                ${central.json({ slug, name: input.name })})
      `
    }

    return {
      ok: true,
      tenant: { tenantId, slug, schemaName, adminUserId },
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log(`  ✗ provisioning failed: ${message}`)

    if (createdSchema) {
      try {
        await central`DROP SCHEMA IF EXISTS ${central(schemaName)} CASCADE`
        log(`  schema ${schemaName} dropped`)
      } catch (dropErr) {
        log(
          `  ! could not drop ${schemaName}: ${dropErr instanceof Error ? dropErr.message : dropErr}`
        )
      }
    }

    if (tenantId) {
      try {
        await central`
          UPDATE payroll_auth.tenant_provisioning
             SET state = 'failed', finished_at = now(), error = ${message}
           WHERE tenant_id = ${tenantId}
        `
        await central`
          DELETE FROM payroll_auth.tenants WHERE id = ${tenantId}
        `
      } catch {
        // Bookkeeping is best-effort; the original error is what we surface.
      }
    }

    return { ok: false, error: { kind: 'provisioning_failed', message } }
  } finally {
    await central.end()
  }
}

/**
 * Seed the four system roles, their default permissions, and the single
 * tenant admin user. Runs against a postgres-js client whose search_path is
 * already pointed at the new tenant schema.
 */
async function seedTenantBootstrapData(
  tenant: postgres.Sql,
  admin: ProvisionTenantInput['admin']
): Promise<string> {
  const roleIds = new Map<SystemRoleCode, string>()

  for (const role of SYSTEM_ROLES) {
    const [{ id }] = await tenant<{ id: string }[]>`
      INSERT INTO roles (code, name, description, is_system)
      VALUES (${role.code}, ${role.name}, ${role.description}, true)
      ON CONFLICT (code) DO UPDATE
        SET name = EXCLUDED.name,
            description = EXCLUDED.description,
            is_system = true,
            updated_at = now()
      RETURNING id
    `
    roleIds.set(role.code, id)

    if (role.permissions.length > 0) {
      // Wipe + re-grant: keeps a tenant in lockstep with the canonical role
      // definition so permission additions land on the next provisioning run.
      await tenant`DELETE FROM role_permissions WHERE role_id = ${id}`
      const rows = role.permissions.map((code) => ({ role_id: id, permission_code: code }))
      await tenant`
        INSERT INTO role_permissions ${tenant(rows, 'role_id', 'permission_code')}
        ON CONFLICT (role_id, permission_code) DO NOTHING
      `
    }
  }

  const tenantAdminRoleId = roleIds.get('tenant_admin')
  if (!tenantAdminRoleId) {
    throw new Error('tenant_admin role was not seeded')
  }

  const [{ id: adminUserId }] = await tenant<{ id: string }[]>`
    INSERT INTO users (email, password_hash, name, role, is_active, is_tenant_admin)
    VALUES (${admin.email.toLowerCase()}, ${admin.passwordHash}, ${admin.name},
            'ADMIN', true, true)
    ON CONFLICT (email) DO UPDATE
      SET password_hash    = EXCLUDED.password_hash,
          name             = EXCLUDED.name,
          is_active        = true,
          is_tenant_admin  = true,
          updated_at       = now()
    RETURNING id
  `

  await tenant`
    INSERT INTO user_roles (user_id, role_id)
    VALUES (${adminUserId}, ${tenantAdminRoleId})
    ON CONFLICT (user_id, role_id) DO NOTHING
  `

  return adminUserId
}

/**
 * Seed the singleton company_config row with the wizard-supplied basic
 * data. The table is meant to hold a single row that the
 * /config/company UI later edits — using INSERT ... WHERE NOT EXISTS
 * keeps this idempotent so re-running provisioning never wipes any
 * fields a tenant admin filled in afterwards.
 *
 * Only the two fields the wizard actually captures (companyName,
 * email) are written; every other column keeps its schema default
 * until the company-settings page is filled in.
 */
async function seedCompanyConfig(
  tenant: postgres.Sql,
  data: { companyName: string; contactEmail: string | null }
): Promise<void> {
  await tenant`
    INSERT INTO company_config (company_name, email)
    SELECT ${data.companyName}, ${data.contactEmail}
     WHERE NOT EXISTS (SELECT 1 FROM company_config)
  `
}
