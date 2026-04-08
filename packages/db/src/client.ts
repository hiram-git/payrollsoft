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

export function createTenantDb(tenantSlug: string, databaseUrl: string): DrizzleDb {
  const key = `tenant:${tenantSlug}`
  const existing = cache.get(key)
  if (existing) return existing
  const db = createDb(databaseUrl, `tenant_${tenantSlug},public`)
  cache.set(key, db)
  return db
}

export function createPublicDb(databaseUrl: string): DrizzleDb {
  const key = 'public'
  const existing = cache.get(key)
  if (existing) return existing
  const db = createDb(databaseUrl)
  cache.set(key, db)
  return db
}
