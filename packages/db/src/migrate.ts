/**
 * TenantMigrationSystem
 * Usage: bun --env-file ../../.env src/migrate.ts --public
 *        bun --env-file ../../.env src/migrate.ts --tenant=acme
 *        bun --env-file ../../.env src/migrate.ts --all-tenants
 */
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'

const args = process.argv.slice(2)
const tenantFlag = args.find((a) => a.startsWith('--tenant='))
const isPublic = args.includes('--public')
const allTenants = args.includes('--all-tenants')

const tenantSlug = tenantFlag?.split('=')[1]

if (!tenantSlug && !isPublic && !allTenants) {
  console.error('Usage: bun src/migrate.ts --tenant=<slug> | --public | --all-tenants')
  process.exit(1)
}

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL is not set')
  process.exit(1)
}

async function migrateTenant(slug: string) {
  // url is guaranteed non-null here (checked above)
  // biome-ignore lint/style/noNonNullAssertion: url checked above
  const sql = postgres(url!, {
    prepare: false,
    connection: { search_path: `tenant_${slug},public` },
  })
  const db = drizzle(sql)
  await sql`CREATE SCHEMA IF NOT EXISTS ${sql(`tenant_${slug}`)}`
  console.log(`  schema tenant_${slug} ensured`)
  await migrate(db, { migrationsFolder: './drizzle/tenant' })
  console.log(`  migrations applied → tenant_${slug}`)
  await sql.end()
}

if (isPublic) {
  const sql = postgres(url, { prepare: false })
  const db = drizzle(sql)
  await migrate(db, { migrationsFolder: './drizzle/public' })
  console.log('Public schema migrations applied')
  await sql.end()
} else if (tenantSlug) {
  await migrateTenant(tenantSlug)
} else if (allTenants) {
  // Read all active tenant slugs from the public schema
  const sql = postgres(url, { prepare: false })
  const rows = await sql<{ slug: string }[]>`
    SELECT slug FROM tenants WHERE is_active = true ORDER BY slug
  `
  await sql.end()

  if (rows.length === 0) {
    console.log('No active tenants found.')
    process.exit(0)
  }

  console.log(
    `Running tenant migrations for ${rows.length} tenant(s): ${rows.map((r) => r.slug).join(', ')}`
  )

  let failed = 0
  for (const { slug } of rows) {
    try {
      console.log(`\n[${slug}]`)
      await migrateTenant(slug)
    } catch (err) {
      console.error(`  ERROR migrating tenant_${slug}:`, err instanceof Error ? err.message : err)
      failed++
    }
  }

  if (failed > 0) {
    console.error(`\n${failed} tenant(s) failed.`)
    process.exit(1)
  }
  console.log('\nAll tenant migrations applied successfully.')
}
