/**
 * Facial-recognition attendance schema.
 *
 * All tables live in the tenant schema (one set per company). Embeddings
 * are stored as pgvector(128) — the dimension produced by the
 * @vladmandic/face-api recognition net used by the kiosk.
 *
 * Raw events arrive from kiosks into `facial_punches`. A periodic
 * consolidator (see packages/core/attendance/consolidator) folds those
 * events into the existing `attendance_records` table so the payroll
 * engine keeps reading from a single source of truth.
 */
import { sql } from 'drizzle-orm'
import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'

/**
 * pgvector column. Drizzle doesn't ship a first-class vector type, so we
 * declare a custom column that serialises arrays to the `[a,b,c]` literal
 * pgvector expects and parses on read.
 */
export const vector = (name: string, dim: number) =>
  customType<{ data: number[]; driverData: string }>({
    dataType() {
      return `vector(${dim})`
    },
    toDriver(value) {
      if (!Array.isArray(value)) throw new Error('vector value must be a number[]')
      if (value.length !== dim) {
        throw new Error(`vector dim mismatch: expected ${dim}, got ${value.length}`)
      }
      return `[${value.join(',')}]`
    },
    fromDriver(value) {
      if (typeof value !== 'string') return value as unknown as number[]
      // pgvector returns "[1,2,3]" — strip brackets and parse.
      const inner = value.startsWith('[') ? value.slice(1, -1) : value
      return inner.split(',').map((n) => Number(n))
    },
  })(name)

// ─── Terminals (kiosks) ───────────────────────────────────────────────────────

export const facialTerminals = pgTable(
  'facial_terminals',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    code: varchar('code', { length: 60 }).notNull(),
    name: varchar('name', { length: 160 }).notNull(),
    location: varchar('location', { length: 200 }),
    status: varchar('status', { length: 20 }).notNull().default('active'),
    apiTokenHash: varchar('api_token_hash', { length: 128 }),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    appVersion: varchar('app_version', { length: 40 }),
    meta: jsonb('meta').default({}).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    codeUnique: uniqueIndex('facial_terminals_code_unique').on(t.code),
  })
)

// ─── Enrollments ──────────────────────────────────────────────────────────────

export const facialEnrollments = pgTable(
  'facial_enrollments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    employeeId: uuid('employee_id').notNull(),
    embedding: vector('embedding', 128).notNull(),
    photoUrl: text('photo_url'),
    qualityScore: numeric('quality_score', { precision: 5, scale: 4 }),
    isPrimary: boolean('is_primary').notNull().default(false),
    status: varchar('status', { length: 20 }).notNull().default('active'),
    enrolledByUserId: uuid('enrolled_by_user_id'),
    enrolledAt: timestamp('enrolled_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    notes: text('notes'),
  },
  (t) => ({
    byEmployee: index('facial_enrollments_employee_idx').on(t.employeeId),
  })
)

// ─── Raw marcaciones (events) ────────────────────────────────────────────────

export const PUNCH_KINDS = ['entry', 'exit', 'lunch_start', 'lunch_end', 'extra'] as const

export const PUNCH_STATUSES = ['verified', 'pending', 'rejected', 'manual'] as const

export const facialPunches = pgTable(
  'facial_punches',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    employeeId: uuid('employee_id'),
    terminalId: uuid('terminal_id'),
    kind: varchar('kind', { length: 20 }).notNull(),
    capturedAt: timestamp('captured_at', { withTimezone: true }).notNull(),
    confidence: numeric('confidence', { precision: 6, scale: 5 }),
    matchDistance: numeric('match_distance', { precision: 6, scale: 5 }),
    livenessScore: numeric('liveness_score', { precision: 5, scale: 4 }),
    photoUrl: text('photo_url'),
    matchedEnrollmentId: uuid('matched_enrollment_id'),
    idempotencyKey: varchar('idempotency_key', { length: 100 }),
    clientEventId: varchar('client_event_id', { length: 100 }),
    source: varchar('source', { length: 20 }).notNull().default('kiosk'),
    status: varchar('status', { length: 20 }).notNull().default('verified'),
    supervisorUserId: uuid('supervisor_user_id'),
    justification: text('justification'),
    deviceMeta: jsonb('device_meta').default({}).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    idempotencyUnique: uniqueIndex('facial_punches_idem_key_unique').on(t.idempotencyKey),
    byEmployeeCaptured: index('facial_punches_employee_captured_idx').on(
      t.employeeId,
      t.capturedAt
    ),
    byCaptured: index('facial_punches_captured_idx').on(t.capturedAt),
    byTerminal: index('facial_punches_terminal_idx').on(t.terminalId),
  })
)

// ─── Terminal event log (heartbeats / audits) ─────────────────────────────────

export const facialTerminalEvents = pgTable(
  'facial_terminal_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    terminalId: uuid('terminal_id').notNull(),
    kind: varchar('kind', { length: 40 }).notNull(),
    payload: jsonb('payload').default({}).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byTerminal: index('facial_terminal_events_terminal_idx').on(t.terminalId, t.createdAt),
  })
)

// ─── Types ────────────────────────────────────────────────────────────────────

export type FacialTerminal = typeof facialTerminals.$inferSelect
export type NewFacialTerminal = typeof facialTerminals.$inferInsert
export type FacialEnrollment = typeof facialEnrollments.$inferSelect
export type NewFacialEnrollment = typeof facialEnrollments.$inferInsert
export type FacialPunch = typeof facialPunches.$inferSelect
export type NewFacialPunch = typeof facialPunches.$inferInsert
export type FacialTerminalEvent = typeof facialTerminalEvents.$inferSelect

export type PunchKind = (typeof PUNCH_KINDS)[number]
export type PunchStatus = (typeof PUNCH_STATUSES)[number]

// Re-export sql so other modules can compose vector distance ops.
export { sql as facialSql }
