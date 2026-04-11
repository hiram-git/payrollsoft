/**
 * Custom Migration Runner — verbose output, full control over SQL execution.
 *
 * Usage:
 *   bun --env-file=../../.env src/migrate.ts --public
 *   bun --env-file=../../.env src/migrate.ts --tenant=demo
 *   bun --env-file=../../.env src/migrate.ts --all-tenants
 *
 * Tracking table: <schema>.__migrations  (tag-based, not hash-based)
 * Each migration entry: { tag, applied_at }
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
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
  console.error('❌  DATABASE_URL is not set')
  process.exit(1)
}

// ─── Journal reader ────────────────────────────────────────────────────────────

type JournalEntry = { idx: number; tag: string }

function readJournal(folder: string): JournalEntry[] {
  const path = join(folder, 'meta', '_journal.json')
  const raw = JSON.parse(readFileSync(path, 'utf8')) as { entries: JournalEntry[] }
  return raw.entries.sort((a, b) => a.idx - b.idx)
}

function readSql(folder: string, tag: string): string {
  return readFileSync(join(folder, `${tag}.sql`), 'utf8')
}

// Split on the Drizzle breakpoint marker (with or without leading newline/space)
function splitStatements(sql: string): string[] {
  return sql
    .split(/--> statement-breakpoint/g)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

// ─── Core runner ──────────────────────────────────────────────────────────────

// PostgreSQL error codes we can safely ignore ("already exists")
const IGNORABLE_CODES = new Set(['42P07', '42710', '42P06', '23505'])

async function runMigrations(
  sql: postgres.Sql,
  folder: string,
  schemaLabel: string
): Promise<void> {
  const journal = readJournal(folder)

  // Ensure tracking table exists in the current search_path schema
  await sql`
    CREATE TABLE IF NOT EXISTS __migrations (
      tag        VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )
  `

  // Load already-applied tags
  const applied = await sql<{ tag: string }[]>`SELECT tag FROM __migrations ORDER BY applied_at`
  const appliedSet = new Set(applied.map((r) => r.tag))

  const isFirstBoot = appliedSet.size === 0
  if (isFirstBoot) {
    console.log(
      `  [${schemaLabel}] First run with new tracker — will skip "already exists" errors from prior migrations`
    )
  } else {
    console.log(`  [${schemaLabel}] ${appliedSet.size} migration(s) already applied:`)
    for (const tag of appliedSet) {
      console.log(`    ✔  ${tag}`)
    }
  }

  const pending = journal.filter((e) => !appliedSet.has(e.tag))

  if (pending.length === 0) {
    console.log(`  [${schemaLabel}] ✅  Nothing new to apply.\n`)
    return
  }

  console.log(`  [${schemaLabel}] ${pending.length} pending migration(s) to run:\n`)

  for (const entry of pending) {
    console.log(`  ── ${entry.tag} ──`)
    const rawSql = readSql(folder, entry.tag)
    const statements = splitStatements(rawSql)
    let skipped = 0

    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i]
      const preview = stmt.replace(/\s+/g, ' ').slice(0, 100)
      process.stdout.write(
        `    [${i + 1}/${statements.length}] ${preview}${stmt.length > 100 ? '…' : ''} → `
      )
      try {
        await sql.unsafe(stmt)
        console.log('✔ OK')
      } catch (err) {
        const pgCode = (err as { code?: string })?.code
        if (isFirstBoot && pgCode && IGNORABLE_CODES.has(pgCode)) {
          console.log('⚠  already exists (skipped)')
          skipped++
        } else {
          console.log('✖ FAILED')
          console.error(`       PG code: ${pgCode ?? 'unknown'}`)
          console.error(`       Message: ${err instanceof Error ? err.message : String(err)}`)
          throw err
        }
      }
    }

    // Record as applied after all statements succeed (or were safely skipped)
    await sql`INSERT INTO __migrations (tag) VALUES (${entry.tag}) ON CONFLICT (tag) DO NOTHING`
    const note = skipped > 0 ? ` (${skipped} stmt(s) skipped — already existed)` : ''
    console.log(`  ✅  ${entry.tag} recorded${note}\n`)
  }

  console.log(`  [${schemaLabel}] All done.\n`)
}

// ─── Tenant helper ─────────────────────────────────────────────────────────────

async function migrateTenant(slug: string) {
  // biome-ignore lint/style/noNonNullAssertion: url checked above
  const sql = postgres(url!, {
    prepare: false,
    connection: { search_path: `tenant_${slug},public` },
    onnotice: () => {}, // suppress NOTICE spam
  })

  try {
    await sql`CREATE SCHEMA IF NOT EXISTS ${sql(`tenant_${slug}`)}`
    console.log(`  schema tenant_${slug} ensured`)
    await runMigrations(sql, './drizzle/tenant', `tenant_${slug}`)
  } finally {
    await sql.end()
  }
}

// ─── Entry point ───────────────────────────────────────────────────────────────

if (isPublic) {
  // biome-ignore lint/style/noNonNullAssertion: url checked above
  const sql = postgres(url!, {
    prepare: false,
    onnotice: () => {},
  })
  try {
    await runMigrations(sql, './drizzle/public', 'public')
  } finally {
    await sql.end()
  }
} else if (tenantSlug) {
  await migrateTenant(tenantSlug)
} else if (allTenants) {
  // biome-ignore lint/style/noNonNullAssertion: url checked above
  const sql = postgres(url!, { prepare: false })
  const rows = await sql<{ slug: string }[]>`
    SELECT slug FROM tenants WHERE is_active = true ORDER BY slug
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
