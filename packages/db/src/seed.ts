/**
 * Seed script — creates demo data for local development
 * Usage: bun --env-file ../../.env src/seed.ts
 *
 * Requires migrations to have been applied first:
 *   bun run db:migrate:public
 *   bun run db:migrate:tenant
 *
 * Creates:
 *  - 1 super admin  (superadmin@payroll.dev / SuperAdmin123!)
 *  - 1 tenant       (slug: demo, schema: tenant_demo)
 *  - 1 tenant user  (admin@demo.com / Admin123!)  role: ADMIN
 */
import postgres from 'postgres'

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL is not set')
  process.exit(1)
}

const SUPER_ADMIN_EMAIL = 'superadmin@payroll.dev'
const SUPER_ADMIN_PASSWORD = 'SuperAdmin123!'
const SUPER_ADMIN_NAME = 'Super Admin'

const TENANT_SLUG = 'demo'
const TENANT_NAME = 'Demo Company'

const USER_EMAIL = 'admin@demo.com'
const USER_PASSWORD = 'Admin123!'
const USER_NAME = 'Demo Admin'

const superAdminHash = await Bun.password.hash(SUPER_ADMIN_PASSWORD, {
  algorithm: 'bcrypt',
  cost: 12,
})
const userHash = await Bun.password.hash(USER_PASSWORD, {
  algorithm: 'bcrypt',
  cost: 12,
})

// Use tenant schema in search_path so the users INSERT works without schema prefix
const publicSql = postgres(url, { prepare: false })
const tenantSql = postgres(url, {
  prepare: false,
  connection: { search_path: `tenant_${TENANT_SLUG},public` },
})

try {
  // ── Super admin ────────────────────────────────────────────────────────────
  await publicSql`
    INSERT INTO super_admins (email, password_hash, name)
    VALUES (${SUPER_ADMIN_EMAIL}, ${superAdminHash}, ${SUPER_ADMIN_NAME})
    ON CONFLICT (email) DO UPDATE
      SET password_hash = EXCLUDED.password_hash,
          name = EXCLUDED.name
  `
  console.log(`✓ Super admin: ${SUPER_ADMIN_EMAIL}`)

  // ── Tenant ─────────────────────────────────────────────────────────────────
  await publicSql`
    INSERT INTO tenants (slug, name, database_schema)
    VALUES (${TENANT_SLUG}, ${TENANT_NAME}, ${`tenant_${TENANT_SLUG}`})
    ON CONFLICT (slug) DO UPDATE
      SET name = EXCLUDED.name
  `
  console.log(`✓ Tenant: ${TENANT_SLUG}`)

  // ── Tenant user (requires db:migrate:tenant to have been run) ──────────────
  try {
    await tenantSql`
      INSERT INTO users (email, password_hash, name, role)
      VALUES (${USER_EMAIL}, ${userHash}, ${USER_NAME}, ${'ADMIN'})
      ON CONFLICT (email) DO UPDATE
        SET password_hash = EXCLUDED.password_hash,
            name = EXCLUDED.name,
            role = EXCLUDED.role
    `
    console.log(`✓ Tenant user: ${USER_EMAIL}`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('does not exist') || msg.includes('no existe')) {
      console.error('\n✗ Tenant tables not found.')
      console.error('  Run migrations first: bun run db:migrate:tenant\n')
    } else {
      console.error('✗ Failed to insert tenant user:', msg)
    }
    process.exit(1)
  }

  console.log('\nSeed complete!')
  console.log(`  Super admin : ${SUPER_ADMIN_EMAIL} / ${SUPER_ADMIN_PASSWORD}`)
  console.log(`  Tenant user : ${USER_EMAIL} / ${USER_PASSWORD}  (X-Tenant: ${TENANT_SLUG})`)
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err)
  if (msg.includes('does not exist') || msg.includes('no existe')) {
    console.error('\n✗ Public tables not found.')
    console.error('  Run migrations first: bun run db:migrate:public\n')
  } else {
    console.error('✗ Seed failed:', msg)
  }
  process.exit(1)
} finally {
  await publicSql.end()
  await tenantSql.end()
}
