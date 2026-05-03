import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

type DrizzleDb = ReturnType<typeof drizzle<typeof schema>>

const cache = new Map<string, DrizzleDb>()

function createDb(url: string, searchPath?: string): DrizzleDb {
  const sql = postgres(url, {
    prepare: false,
    ...(searchPath ? { connection: { search_path: searchPath } } : {}),
  })
  return drizzle(sql, { schema })
}

/**
 * Build a per-tenant Drizzle client.
 *
 * The search_path puts `tenant_<slug>` first so unqualified references
 * resolve to tenant-local tables, then `payroll_auth` so RBAC catalog
 * lookups work without fully-qualified names, and finally `public` for
 * Postgres extensions and anything not yet relocated.
 */
export function createTenantDb(tenantSlug: string, databaseUrl: string): DrizzleDb {
  const key = `tenant:${tenantSlug}`
  const existing = cache.get(key)
  if (existing) return existing
  const db = createDb(databaseUrl, `tenant_${tenantSlug},payroll_auth,public`)
  cache.set(key, db)
  return db
}

/**
 * Build the global (cross-tenant) Drizzle client used for tenant management,
 * super-admin auth and the permissions catalog. Search path: payroll_auth, public.
 */
export function createPublicDb(databaseUrl: string): DrizzleDb {
  const key = 'public'
  const existing = cache.get(key)
  if (existing) return existing
  const db = createDb(databaseUrl, 'payroll_auth,public')
  cache.set(key, db)
  return db
}
