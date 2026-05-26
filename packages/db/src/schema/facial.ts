/**
 * Facial-recognition attendance schema.
 *
 * All tables live in the tenant schema (one set per company). Embeddings
 * are stored as jsonb arrays (number[128]) — the 128-dim output of the
 * @vladmandic/face-api recognition net used by the kiosk.
 *
 * Matching (cosine distance) runs in application code, which handles
 * <1000 employees easily. For larger deployments, pgvector can be
 * layered on top (see docs/FACIAL-RECOGNITION.md § performance).
 *
 * Raw events arrive from kiosks into `facial_marcaciones`. A periodic
 * consolidator (see packages/core/attendance/consolidator) folds those
 * events into the existing `attendance_records` table so the payroll
 * engine keeps reading from a single source of truth.
 */
import { sql } from 'drizzle-orm'
import {
  boolean,
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'

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
    embedding: jsonb('embedding').$type<number[]>().notNull(),
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

export const MARCACION_KINDS = ['entry', 'exit', 'lunch_start', 'lunch_end', 'extra'] as const

export const MARCACION_STATUSES = ['verified', 'pending', 'rejected', 'manual'] as const

export const facialMarcaciones = pgTable(
  'facial_marcaciones',
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
    idempotencyUnique: uniqueIndex('facial_marcaciones_idem_key_unique').on(t.idempotencyKey),
    byEmployeeCaptured: index('facial_marcaciones_employee_captured_idx').on(
      t.employeeId,
      t.capturedAt
    ),
    byCaptured: index('facial_marcaciones_captured_idx').on(t.capturedAt),
    byTerminal: index('facial_marcaciones_terminal_idx').on(t.terminalId),
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
export type FacialMarcacion = typeof facialMarcaciones.$inferSelect
export type NewFacialMarcacion = typeof facialMarcaciones.$inferInsert
export type FacialTerminalEvent = typeof facialTerminalEvents.$inferSelect

export type MarcacionKind = (typeof MARCACION_KINDS)[number]
export type MarcacionStatus = (typeof MARCACION_STATUSES)[number]

// Re-export sql so other modules can compose vector distance ops.
export { sql as facialSql }
