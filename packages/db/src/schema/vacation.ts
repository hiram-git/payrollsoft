import { date, integer, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'
import { employees } from './employee'

export const vacationBalances = pgTable('vacation_balances', {
  id: uuid('id').defaultRandom().primaryKey(),
  employeeId: uuid('employee_id')
    .notNull()
    .references(() => employees.id)
    .unique(),
  // Days stored as strings for precision consistency
  daysEarned: varchar('days_earned', { length: 10 }).notNull().default('0'),
  daysUsed: varchar('days_used', { length: 10 }).notNull().default('0'),
  daysBalance: varchar('days_balance', { length: 10 }).notNull().default('0'),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const vacationRequests = pgTable('vacation_requests', {
  id: uuid('id').defaultRandom().primaryKey(),
  employeeId: uuid('employee_id')
    .notNull()
    .references(() => employees.id),
  startDate: date('start_date').notNull(),
  endDate: date('end_date').notNull(),
  daysRequested: integer('days_requested').notNull(),
  status: varchar('status', { length: 20 }).notNull().default('pending'),
  notes: varchar('notes', { length: 500 }),
  approvedBy: uuid('approved_by'),
  approvedAt: timestamp('approved_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export type VacationBalance = typeof vacationBalances.$inferSelect
export type VacationRequest = typeof vacationRequests.$inferSelect
export type NewVacationRequest = typeof vacationRequests.$inferInsert
