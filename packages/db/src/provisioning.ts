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
import { DEFAULT_CONCEPTS } from './default-concepts'
import { runMigrations } from './migrator'
import { type SeedEmployeesResult, seedEmployees } from './seeds/employees'
import { type SeedLoansResult, seedLoans } from './seeds/loans'

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
  /**
   * Seeds opcionales a ejecutar después del bootstrap. Cada uno se
   * marca como aplicado en `tenants.metadata.seeds.<code>` y no se
   * vuelve a ejecutar desde la UI; revertir requiere acción directa
   * en la base de datos.
   */
  seeds?: {
    employees?: boolean
    loans?: boolean
    /** Cantidad de empleados a sembrar; default 200. */
    employeesTotal?: number
  }
}

export type SeedOutcome =
  | { kind: 'employees'; ok: true; result: SeedEmployeesResult }
  | { kind: 'loans'; ok: true; result: SeedLoansResult }
  | { kind: 'employees' | 'loans'; ok: false; error: string }

export type ProvisionedTenant = {
  tenantId: string
  slug: string
  schemaName: string
  adminUserId: string
  seedsApplied: SeedOutcome[]
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
    const seedsApplied: SeedOutcome[] = []
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
      await seedDefaultConcepts(tenant)

      // ── Seeds opcionales ───────────────────────────────────────────
      // Se ejecutan en orden (empleados antes que préstamos, porque
      // loans depende de employees). Cada falla se registra pero no
      // aborta la provisión: el tenant ya quedó usable y el operador
      // ve el detalle en el banner de resultado.
      if (input.seeds?.employees) {
        try {
          const result = await seedEmployees(tenant, {
            total: input.seeds.employeesTotal,
            log,
          })
          seedsApplied.push({ kind: 'employees', ok: true, result })
        } catch (err) {
          seedsApplied.push({
            kind: 'employees',
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          })
        }
      }
      if (input.seeds?.loans) {
        try {
          const result = await seedLoans(tenant, { log })
          seedsApplied.push({ kind: 'loans', ok: true, result })
        } catch (err) {
          seedsApplied.push({
            kind: 'loans',
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          })
        }
      }
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
                ${central.json({ slug, name: input.name, seeds: input.seeds ?? null })})
      `
    }

    // Persist the per-seed marker into tenants.metadata.seeds so the
    // wizard / detail page can detect "already applied". Failures are
    // recorded too so the operator can retry from the UI.
    for (const outcome of seedsApplied) {
      const entry: Record<string, unknown> = outcome.ok
        ? {
            applied_at: new Date().toISOString(),
            applied_by: input.superAdminId ?? null,
            stats: outcome.result,
          }
        : {
            failed_at: new Date().toISOString(),
            applied_by: input.superAdminId ?? null,
            error: outcome.error,
          }
      await central`
        UPDATE payroll_auth.tenants
           SET metadata = jsonb_set(
                 COALESCE(metadata, '{}'::jsonb),
                 ${central.array(['seeds', outcome.kind])}::text[],
                 ${central.json(entry)}::jsonb,
                 true
               ),
               updated_at = now()
         WHERE id = ${tenantId}
      `
      if (input.superAdminId) {
        await central`
          INSERT INTO payroll_auth.super_admin_audit (super_admin_id, tenant_id, action, payload)
          VALUES (${input.superAdminId}, ${tenantId}, ${`tenant.seed.${outcome.kind}`},
                  ${central.json(entry)})
        `
      }
    }

    return {
      ok: true,
      tenant: { tenantId, slug, schemaName, adminUserId, seedsApplied },
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

/**
 * Carga los conceptos canónicos (ISLR + sueldo, seguros sociales y
 * educativos) para que la primera planilla de la empresa tenga las
 * fórmulas armadas. Idempotente vía ON CONFLICT — re-provisionar no
 * pisa los flags si el admin los editó después.
 */
async function seedDefaultConcepts(tenant: postgres.Sql): Promise<void> {
  for (const c of DEFAULT_CONCEPTS) {
    await tenant`
      INSERT INTO concepts (
        code, name, type, formula, is_active, unit,
        print_details, prorates, allow_modify,
        is_reference_value, use_amount_calc, allow_zero
      )
      VALUES (
        ${c.code}, ${c.name}, ${c.type}, ${c.formula}, true, ${c.unit},
        ${c.printDetails}, ${c.prorates}, ${c.allowModify},
        ${c.isReferenceValue}, ${c.useAmountCalc}, ${c.allowZero}
      )
      ON CONFLICT (code) DO NOTHING
    `
  }
}

// ── Aplicación post-creación de un seed individual ─────────────────────────

export type ApplySeedResult =
  | { ok: true; kind: 'employees'; result: SeedEmployeesResult }
  | { ok: true; kind: 'loans'; result: SeedLoansResult }
  | {
      ok: false
      kind: 'employees' | 'loans'
      error: 'already_applied' | 'tenant_not_found' | 'failed'
      message?: string
    }

/**
 * Aplica un seed sobre un tenant que ya fue aprovisionado. Lee el flag
 * `metadata.seeds.<code>.applied_at` y rechaza si ya tiene aplicación
 * exitosa previa — la UI no permite revertir, solo intervención
 * directa en BD puede limpiar la marca.
 */
export async function applySeedToTenant(
  databaseUrl: string,
  slug: string,
  seedCode: 'employees' | 'loans',
  options: { superAdminId?: string; employeesTotal?: number; log?: (line: string) => void } = {}
): Promise<ApplySeedResult> {
  const slugCheck = validateTenantSlug(slug)
  if (!slugCheck.ok) {
    return { ok: false, kind: seedCode, error: 'tenant_not_found', message: slugCheck.message }
  }
  const log = options.log ?? (() => {})

  const central = postgres(databaseUrl, {
    prepare: false,
    connection: { search_path: 'payroll_auth,public' },
    onnotice: () => {},
  })

  try {
    const tenantRows = await central<{ id: string; metadata: Record<string, unknown> }[]>`
      SELECT id, metadata FROM payroll_auth.tenants WHERE slug = ${slugCheck.slug} LIMIT 1
    `
    const tenantRow = tenantRows[0]
    if (!tenantRow) {
      return { ok: false, kind: seedCode, error: 'tenant_not_found' }
    }
    const meta = (tenantRow.metadata ?? {}) as Record<string, Record<string, unknown>>
    const prior = meta.seeds?.[seedCode] as Record<string, unknown> | undefined
    if (prior && typeof prior.applied_at === 'string') {
      return { ok: false, kind: seedCode, error: 'already_applied' }
    }

    const tenant = postgres(databaseUrl, {
      prepare: false,
      connection: { search_path: `tenant_${slugCheck.slug},payroll_auth,public` },
      onnotice: () => {},
    })

    let outcome: ApplySeedResult
    try {
      if (seedCode === 'employees') {
        const result = await seedEmployees(tenant, {
          total: options.employeesTotal,
          log,
        })
        outcome = { ok: true, kind: 'employees', result }
      } else {
        const result = await seedLoans(tenant, { log })
        outcome = { ok: true, kind: 'loans', result }
      }
    } catch (err) {
      outcome = {
        ok: false,
        kind: seedCode,
        error: 'failed',
        message: err instanceof Error ? err.message : String(err),
      }
    } finally {
      await tenant.end()
    }

    const entry: Record<string, unknown> = outcome.ok
      ? {
          applied_at: new Date().toISOString(),
          applied_by: options.superAdminId ?? null,
          stats: outcome.result,
        }
      : {
          failed_at: new Date().toISOString(),
          applied_by: options.superAdminId ?? null,
          error: outcome.message,
        }
    await central`
      UPDATE payroll_auth.tenants
         SET metadata = jsonb_set(
               COALESCE(metadata, '{}'::jsonb),
               ${central.array(['seeds', seedCode])}::text[],
               ${central.json(entry)}::jsonb,
               true
             ),
             updated_at = now()
       WHERE id = ${tenantRow.id}
    `
    if (options.superAdminId) {
      await central`
        INSERT INTO payroll_auth.super_admin_audit (super_admin_id, tenant_id, action, payload)
        VALUES (${options.superAdminId}, ${tenantRow.id}, ${`tenant.seed.${seedCode}`},
                ${central.json(entry)})
      `
    }
    return outcome
  } finally {
    await central.end()
  }
}
