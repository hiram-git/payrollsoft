import {
  boolean,
  date,
  integer,
  jsonb,
  pgTable,
  text,
  time,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'

export const shifts = pgTable('shifts', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  entryTime: time('entry_time').notNull(),
  lunchStartTime: time('lunch_start_time'),
  lunchEndTime: time('lunch_end_time'),
  exitTime: time('exit_time').notNull(),
  entryToleranceBefore: integer('entry_tolerance_before').notNull().default(0),
  entryToleranceAfter: integer('entry_tolerance_after').notNull().default(0),
  lunchStartToleranceBefore: integer('lunch_start_tolerance_before').notNull().default(0),
  lunchStartToleranceAfter: integer('lunch_start_tolerance_after').notNull().default(0),
  lunchEndToleranceBefore: integer('lunch_end_tolerance_before').notNull().default(0),
  lunchEndToleranceAfter: integer('lunch_end_tolerance_after').notNull().default(0),
  exitToleranceBefore: integer('exit_tolerance_before').notNull().default(0),
  exitToleranceAfter: integer('exit_tolerance_after').notNull().default(0),
  /** ISO weekdays (1=Mon..7=Sun) the shift applies to. Defaults to M-F. */
  weekdays: integer('weekdays').array().notNull().default([1, 2, 3, 4, 5]),
  isDefault: boolean('is_default').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const workCalendar = pgTable('work_calendar', {
  id: uuid('id').defaultRandom().primaryKey(),
  date: date('date').notNull().unique(),
  shiftId: uuid('shift_id'),
  isWorkday: boolean('is_workday').notNull().default(true),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
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
  /** 'present' | 'late' | 'absent' | 'partial' | 'holiday' */
  status: varchar('status', { length: 20 }).notNull().default('present'),
  shiftId: uuid('shift_id'),
  source: varchar('source', { length: 50 }).default('manual'),
  rawData: jsonb('raw_data').default({}),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export type Shift = typeof shifts.$inferSelect
export type NewShift = typeof shifts.$inferInsert
export type ShiftRow = Shift
export type Tolerance = typeof tolerances.$inferSelect
export type AttendanceRecord = typeof attendanceRecords.$inferSelect
export type NewAttendanceRecord = typeof attendanceRecords.$inferInsert
export type WorkCalendarRow = typeof workCalendar.$inferSelect
export type NewWorkCalendarRow = typeof workCalendar.$inferInsert
