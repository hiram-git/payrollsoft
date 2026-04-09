/**
 * Seed script — creates demo data for local development
 * Usage: bun --env-file ../../.env run src/seed.ts
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
const userHash = await Bun.password.hash(USER_PASSWORD, { algorithm: 'bcrypt', cost: 12 })

const sql = postgres(url, { prepare: false })

try {
  // ── Super admin ────────────────────────────────────────────────────────────
  await sql`
    INSERT INTO super_admins (email, password_hash, name)
    VALUES (${SUPER_ADMIN_EMAIL}, ${superAdminHash}, ${SUPER_ADMIN_NAME})
    ON CONFLICT (email) DO UPDATE
      SET password_hash = EXCLUDED.password_hash,
          name = EXCLUDED.name
  `
  console.log(`Super admin upserted: ${SUPER_ADMIN_EMAIL}`)

  // ── Tenant ─────────────────────────────────────────────────────────────────
  await sql`
    INSERT INTO tenants (slug, name, database_schema)
    VALUES (${TENANT_SLUG}, ${TENANT_NAME}, ${`tenant_${TENANT_SLUG}`})
    ON CONFLICT (slug) DO UPDATE
      SET name = EXCLUDED.name
  `
  console.log(`Tenant upserted: ${TENANT_SLUG}`)

  // ── Tenant schema + user ───────────────────────────────────────────────────
  await sql`CREATE SCHEMA IF NOT EXISTS ${sql(`tenant_${TENANT_SLUG}`)}`

  await sql`
    INSERT INTO tenant_demo.users (email, password_hash, name, role)
    VALUES (${USER_EMAIL}, ${userHash}, ${USER_NAME}, ${'ADMIN'})
    ON CONFLICT (email) DO UPDATE
      SET password_hash = EXCLUDED.password_hash,
          name = EXCLUDED.name,
          role = EXCLUDED.role
  `
  console.log(`Tenant user upserted: ${USER_EMAIL}`)

  console.log('\nSeed complete!')
  console.log(`  Super admin : ${SUPER_ADMIN_EMAIL} / ${SUPER_ADMIN_PASSWORD}`)
  console.log(`  Tenant user : ${USER_EMAIL} / ${USER_PASSWORD}  (X-Tenant: ${TENANT_SLUG})`)
} finally {
  await sql.end()
}
