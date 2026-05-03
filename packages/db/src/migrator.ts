import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type postgres from 'postgres'

/**
 * Reusable Drizzle journal runner. Lifted out of src/migrate.ts so both the
 * CLI and the runtime tenant-provisioning service can share the same logic.
 *
 * The runner is forward-only and idempotent:
 *  - Each tenant/public schema gets a `__migrations` table that records the
 *    applied tags.
 *  - Pending migrations are applied in order; "already exists" Postgres
 *    error codes are ignored so a partially-applied environment can be
 *    re-run without dropping anything.
 */

type JournalEntry = { idx: number; tag: string }

function readJournal(folder: string): JournalEntry[] {
  const path = join(folder, 'meta', '_journal.json')
  const raw = JSON.parse(readFileSync(path, 'utf8')) as { entries: JournalEntry[] }
  return raw.entries.sort((a, b) => a.idx - b.idx)
}

function readSql(folder: string, tag: string): string {
  return readFileSync(join(folder, `${tag}.sql`), 'utf8')
}

function splitStatements(sql: string): string[] {
  return sql
    .split(/--> statement-breakpoint/g)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

const IGNORABLE_CODES = new Set([
  '42P07', // relation already exists
  '42710', // object already exists
  '42P06', // schema already exists
  '42701', // column already exists
  '42P16', // constraint already exists (index)
  '23505', // unique violation (idempotent inserts)
])

export type RunMigrationsOptions = {
  /** Folder holding the Drizzle journal and SQL files. */
  folder: string
  /** Human-readable label printed in logs. */
  schemaLabel: string
  /** Optional sink for progress logs. Defaults to console.log. */
  log?: (line: string) => void
}

export async function runMigrations(
  sql: postgres.Sql,
  { folder, schemaLabel, log = console.log }: RunMigrationsOptions
): Promise<void> {
  const journal = readJournal(folder)

  await sql`
    CREATE TABLE IF NOT EXISTS __migrations (
      tag        VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )
  `

  const applied = await sql<{ tag: string }[]>`SELECT tag FROM __migrations ORDER BY applied_at`
  const appliedSet = new Set(applied.map((r) => r.tag))
  const pending = journal.filter((e) => !appliedSet.has(e.tag))

  if (pending.length === 0) {
    log(`  [${schemaLabel}] nothing to apply (${appliedSet.size} already recorded).`)
    return
  }

  log(`  [${schemaLabel}] applying ${pending.length} migration(s)...`)

  for (const entry of pending) {
    const rawSql = readSql(folder, entry.tag)
    const statements = splitStatements(rawSql)

    for (const stmt of statements) {
      try {
        await sql.unsafe(stmt)
      } catch (err) {
        const pgCode = (err as { code?: string })?.code
        if (pgCode && IGNORABLE_CODES.has(pgCode)) {
          continue
        }
        throw err
      }
    }

    await sql`INSERT INTO __migrations (tag) VALUES (${entry.tag}) ON CONFLICT (tag) DO NOTHING`
    log(`    ✔  ${entry.tag}`)
  }
}
