import {
  bigint,
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'

// ── Ingestion worker state (one row per device) ─────────────────────────────

export const attendanceIngestionState = pgTable(
  'attendance_ingestion_state',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    deviceId: uuid('device_id').notNull(),
    status: varchar('status', { length: 20 }).notNull().default('stopped'),
    intervalMinutes: integer('interval_minutes').notNull().default(5),
    highWaterMark: timestamp('high_water_mark', { withTimezone: true }),
    lastFileHash: varchar('last_file_hash', { length: 64 }),
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
    lastError: text('last_error'),
    punchesIngested: integer('punches_ingested').notNull().default(0),
    autoStart: boolean('auto_start').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    deviceUnique: uniqueIndex('att_ingestion_state_device_uq').on(t.deviceId),
    statusIdx: index('att_ingestion_state_status_idx').on(t.status),
  })
)

export const attendanceIngestionLog = pgTable(
  'attendance_ingestion_log',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    deviceId: uuid('device_id').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    status: varchar('status', { length: 20 }).notNull(),
    punchesFound: integer('punches_found').notNull().default(0),
    punchesNew: integer('punches_new').notNull().default(0),
    punchesSkipped: integer('punches_skipped').notNull().default(0),
    unknownEmployees: integer('unknown_employees').notNull().default(0),
    highWaterBefore: timestamp('high_water_before', { withTimezone: true }),
    highWaterAfter: timestamp('high_water_after', { withTimezone: true }),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    deviceIdx: index('att_ingestion_log_device_idx').on(t.deviceId, t.createdAt),
  })
)

// ── Consolidation worker state (singleton per tenant) ───────────────────────

export const attendanceConsolidationState = pgTable('attendance_consolidation_state', {
  id: uuid('id').defaultRandom().primaryKey(),
  status: varchar('status', { length: 20 }).notNull().default('stopped'),
  intervalMinutes: integer('interval_minutes').notNull().default(15),
  highWaterMark: bigint('high_water_mark', { mode: 'number' }).notNull().default(0),
  lastRunAt: timestamp('last_run_at', { withTimezone: true }),
  lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
  lastError: text('last_error'),
  daysConsolidated: integer('days_consolidated').notNull().default(0),
  autoStart: boolean('auto_start').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const attendanceConsolidationLog = pgTable(
  'attendance_consolidation_log',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    status: varchar('status', { length: 20 }).notNull(),
    punchesFound: integer('punches_found').notNull().default(0),
    daysAffected: integer('days_affected').notNull().default(0),
    employeesProcessed: integer('employees_processed').notNull().default(0),
    employeesAbsent: integer('employees_absent').notNull().default(0),
    highWaterBefore: bigint('high_water_before', { mode: 'number' }),
    highWaterAfter: bigint('high_water_after', { mode: 'number' }),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    createdIdx: index('att_consolidation_log_created_idx').on(t.createdAt),
  })
)

export type AttendanceIngestionState = typeof attendanceIngestionState.$inferSelect
export type AttendanceConsolidationState = typeof attendanceConsolidationState.$inferSelect
