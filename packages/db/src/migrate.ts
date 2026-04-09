/**
 * TenantMigrationSystem
 * Usage: bun --env-file ../../.env run src/migrate.ts --public
 *        bun --env-file ../../.env run src/migrate.ts --tenant=acme
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

if (isPublic) {
  const sql = postgres(url, { prepare: false })
  const db = drizzle(sql)
  await migrate(db, { migrationsFolder: './drizzle/public' })
  console.log('Public schema migrations applied')
  await sql.end()
} else if (tenantSlug) {
  const sql = postgres(url, {
    prepare: false,
    connection: { search_path: `tenant_${tenantSlug},public` },
  })
  const db = drizzle(sql)
  await sql`CREATE SCHEMA IF NOT EXISTS ${sql(`tenant_${tenantSlug}`)}`
  console.log(`Schema tenant_${tenantSlug} ensured`)
  await migrate(db, { migrationsFolder: './drizzle/tenant' })
  console.log(`Tenant migrations applied (schema: tenant_${tenantSlug})`)
  await sql.end()
}
