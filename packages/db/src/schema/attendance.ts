import {
  boolean,
  date,
  integer,
  jsonb,
  pgTable,
  time,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'
export const shifts = pgTable('shifts', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  startTime: time('start_time').notNull(),
  endTime: time('end_time').notNull(),
  lunchMinutes: integer('lunch_minutes').notNull().default(60),
  isDefault: boolean('is_default').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const tolerances = pgTable('tolerances', {
  id: uuid('id').defaultRandom().primaryKey(),
  entryToleranceMinutes: integer('entry_tolerance_minutes').notNull().default(0),
  exitToleranceMinutes: integer('exit_tolerance_minutes').notNull().default(0),
  type: varchar('type', { length: 20 }).notNull().default('strict'), // strict | flexible
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const attendanceRecords = pgTable('attendance_records', {
  id: uuid('id').defaultRandom().primaryKey(),
  employeeId: uuid('employee_id').notNull(),
  date: date('date').notNull(),
  checkIn: timestamp('check_in'),
  checkOut: timestamp('check_out'),
  lunchStart: timestamp('lunch_start'),
  lunchEnd: timestamp('lunch_end'),
  workedMinutes: integer('worked_minutes').default(0),
  lateMinutes: integer('late_minutes').default(0),
  overtimeMinutes: integer('overtime_minutes').default(0),
  source: varchar('source', { length: 50 }).default('manual'), // manual | webhook | import
  rawData: jsonb('raw_data').default({}),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export type Shift = typeof shifts.$inferSelect
export type NewShift = typeof shifts.$inferInsert
export type Tolerance = typeof tolerances.$inferSelect
export type AttendanceRecord = typeof attendanceRecords.$inferSelect
export type NewAttendanceRecord = typeof attendanceRecords.$inferInsert
