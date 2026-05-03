/**
 * Validation for tenant slugs. The slug becomes part of a PostgreSQL schema
 * name (`tenant_<slug>`) so the rules are deliberately strict:
 *
 *  - lowercase ASCII letters, digits, dash and underscore only
 *  - must start with an alphanumeric (no leading dash/underscore)
 *  - 3..50 characters
 *  - cannot be a reserved/blacklisted name
 *
 * The same regex is enforced as a CHECK constraint in payroll_auth.tenants
 * (see drizzle/public/0001_payroll_auth_schema.sql).
 */

export const TENANT_SLUG_PATTERN = /^[a-z0-9][a-z0-9_-]{2,49}$/

/**
 * Names that must never be used as a tenant slug because they collide with
 * Postgres internals, our central schema, or routes that would otherwise be
 * shadowed by a tenant subdomain.
 */
export const RESERVED_TENANT_SLUGS: ReadonlySet<string> = new Set([
  'public',
  'pg_catalog',
  'pg_toast',
  'pg_temp',
  'information_schema',
  'payroll_auth',
  'tenant',
  'tenants',
  'admin',
  'superadmin',
  'super_admin',
  'api',
  'app',
  'auth',
  'www',
  'mail',
  'static',
  'assets',
  'public_api',
  'system',
  'root',
])

export type TenantSlugError = 'EMPTY' | 'TOO_SHORT' | 'TOO_LONG' | 'INVALID_FORMAT' | 'RESERVED'

export type TenantSlugValidation =
  | { ok: true; slug: string }
  | { ok: false; error: TenantSlugError; message: string }

export function validateTenantSlug(input: unknown): TenantSlugValidation {
  if (typeof input !== 'string' || input.length === 0) {
    return { ok: false, error: 'EMPTY', message: 'Slug is required.' }
  }

  const slug = input.trim().toLowerCase()

  if (slug.length < 3) {
    return { ok: false, error: 'TOO_SHORT', message: 'Slug must be at least 3 characters.' }
  }
  if (slug.length > 50) {
    return { ok: false, error: 'TOO_LONG', message: 'Slug must be at most 50 characters.' }
  }
  if (!TENANT_SLUG_PATTERN.test(slug)) {
    return {
      ok: false,
      error: 'INVALID_FORMAT',
      message:
        'Slug must start with a lowercase letter or digit and contain only lowercase letters, digits, dashes or underscores.',
    }
  }
  if (slug.startsWith('pg_')) {
    return { ok: false, error: 'RESERVED', message: 'Slugs starting with "pg_" are reserved.' }
  }
  if (RESERVED_TENANT_SLUGS.has(slug)) {
    return { ok: false, error: 'RESERVED', message: `"${slug}" is a reserved name.` }
  }

  return { ok: true, slug }
}

/**
 * Returns the schema name corresponding to a validated slug. Throws if the
 * slug is invalid — callers should validate first via validateTenantSlug.
 */
export function tenantSchemaName(slug: string): string {
  const result = validateTenantSlug(slug)
  if (!result.ok) {
    throw new Error(`Invalid tenant slug: ${result.message}`)
  }
  return `tenant_${result.slug}`
}
