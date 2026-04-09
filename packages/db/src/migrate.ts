/**
 * TenantMigrationSystem
 * Usage: bun run src/migrate.ts --tenant=acme
 *        bun run src/migrate.ts --public   (runs public schema migrations only)
 */
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'

const args = process.argv.slice(2)
const tenantFlag = args.find((a) => a.startsWith('--tenant='))
const isPublic = args.includes('--public')

const tenantSlug = tenantFlag?.split('=')[1]

if (!tenantSlug && !isPublic) {
  console.error('Usage: bun run src/migrate.ts --tenant=<slug> | --public')
  process.exit(1)
}

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL is not set')
  process.exit(1)
}

const searchPath = tenantSlug ? `tenant_${tenantSlug},public` : 'public'
const sql = postgres(url, { prepare: false, connection: { search_path: searchPath } })
const db = drizzle(sql)

if (tenantSlug) {
  // Create schema if it doesn't exist
  await sql`CREATE SCHEMA IF NOT EXISTS ${sql(`tenant_${tenantSlug}`)}`
  console.log(`Schema tenant_${tenantSlug} ensured`)
}

await migrate(db, { migrationsFolder: './drizzle' })
console.log(`Migrations applied (schema: ${searchPath})`)

await sql.end()
