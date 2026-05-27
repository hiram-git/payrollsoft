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

export const attendanceSyncState = pgTable(
  'attendance_sync_state',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    deviceId: uuid('device_id').notNull(),
    status: varchar('status', { length: 20 }).notNull().default('stopped'),
    intervalMinutes: integer('interval_minutes').notNull().default(15),
    highWaterMark: bigint('high_water_mark', { mode: 'number' }).notNull().default(0),
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
    lastError: text('last_error'),
    punchesSynced: integer('punches_synced').notNull().default(0),
    daysConsolidated: integer('days_consolidated').notNull().default(0),
    autoStart: boolean('auto_start').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    deviceUnique: uniqueIndex('attendance_sync_state_device_unique').on(t.deviceId),
    statusIdx: index('attendance_sync_state_status_idx').on(t.status),
  })
)

export const attendanceSyncLog = pgTable(
  'attendance_sync_log',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    deviceId: uuid('device_id').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    status: varchar('status', { length: 20 }).notNull(),
    punchesFound: integer('punches_found').notNull().default(0),
    punchesConsolidated: integer('punches_consolidated').notNull().default(0),
    daysAffected: integer('days_affected').notNull().default(0),
    highWaterBefore: bigint('high_water_before', { mode: 'number' }),
    highWaterAfter: bigint('high_water_after', { mode: 'number' }),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    deviceIdx: index('attendance_sync_log_device_idx').on(t.deviceId, t.createdAt),
  })
)

export type AttendanceSyncState = typeof attendanceSyncState.$inferSelect
export type NewAttendanceSyncState = typeof attendanceSyncState.$inferInsert
export type AttendanceSyncLog = typeof attendanceSyncLog.$inferSelect
export type NewAttendanceSyncLog = typeof attendanceSyncLog.$inferInsert
