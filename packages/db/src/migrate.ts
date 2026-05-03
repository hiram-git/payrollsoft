/**
 * CLI wrapper around the shared migration runner.
 *
 * Usage:
 *   bun --env-file=../../.env src/migrate.ts --public
 *   bun --env-file=../../.env src/migrate.ts --tenant=demo
 *   bun --env-file=../../.env src/migrate.ts --all-tenants
 */
import postgres from 'postgres'
import { runMigrations } from './migrator'

const args = process.argv.slice(2)
const tenantFlag = args.find((a: string) => a.startsWith('--tenant='))
const isPublic = args.includes('--public')
const allTenants = args.includes('--all-tenants')
const tenantSlug = tenantFlag?.split('=')[1]

if (!tenantSlug && !isPublic && !allTenants) {
  console.error('Usage: bun src/migrate.ts --tenant=<slug> | --public | --all-tenants')
  process.exit(1)
}

const url = process.env.DATABASE_URL
if (!url) {
  console.error('❌  DATABASE_URL is not set')
  process.exit(1)
}

async function migrateTenant(slug: string) {
  // biome-ignore lint/style/noNonNullAssertion: url checked above
  const sql = postgres(url!, {
    prepare: false,
    connection: { search_path: `tenant_${slug},payroll_auth,public` },
    onnotice: () => {},
  })

  try {
    await sql`CREATE SCHEMA IF NOT EXISTS ${sql(`tenant_${slug}`)}`
    console.log(`  schema tenant_${slug} ensured`)
    await runMigrations(sql, { folder: './drizzle/tenant', schemaLabel: `tenant_${slug}` })
  } finally {
    await sql.end()
  }
}

if (isPublic) {
  // biome-ignore lint/style/noNonNullAssertion: url checked above
  const sql = postgres(url!, {
    prepare: false,
    connection: { search_path: 'payroll_auth,public' },
    onnotice: () => {},
  })
  try {
    await runMigrations(sql, { folder: './drizzle/public', schemaLabel: 'payroll_auth' })
  } finally {
    await sql.end()
  }
} else if (tenantSlug) {
  await migrateTenant(tenantSlug)
} else if (allTenants) {
  // biome-ignore lint/style/noNonNullAssertion: url checked above
  const sql = postgres(url!, {
    prepare: false,
    connection: { search_path: 'payroll_auth,public' },
  })
  const rows = await sql<{ slug: string }[]>`
    SELECT slug FROM payroll_auth.tenants
     WHERE status IN ('ACTIVE','PROVISIONING')
     ORDER BY slug
  `
  await sql.end()

  if (rows.length === 0) {
    console.log('No active tenants found.')
    process.exit(0)
  }

  console.log(
    `Running migrations for ${rows.length} tenant(s): ${rows.map((r) => r.slug).join(', ')}`
  )

  let failed = 0
  for (const { slug } of rows) {
    console.log(`\n[${slug}]`)
    try {
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
