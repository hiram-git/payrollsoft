import { boolean, date, jsonb, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'
import { employees } from './employee'

export const concepts = pgTable('concepts', {
  id: uuid('id').defaultRandom().primaryKey(),
  code: varchar('code', { length: 20 }).notNull().unique(),
  name: varchar('name', { length: 255 }).notNull(),
  type: varchar('type', { length: 20 }).notNull(), // income | deduction
  formula: text('formula'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const payrolls = pgTable('payrolls', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  type: varchar('type', { length: 50 }).notNull(), // regular | thirteenth | special
  frequency: varchar('frequency', { length: 20 }).notNull(), // biweekly | monthly | weekly
  periodStart: date('period_start').notNull(),
  periodEnd: date('period_end').notNull(),
  paymentDate: date('payment_date'),
  status: varchar('status', { length: 20 }).notNull().default('draft'),
  totalGross: varchar('total_gross', { length: 20 }).notNull().default('0'),
  totalDeductions: varchar('total_deductions', { length: 20 }).notNull().default('0'),
  totalNet: varchar('total_net', { length: 20 }).notNull().default('0'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const payrollLines = pgTable('payroll_lines', {
  id: uuid('id').defaultRandom().primaryKey(),
  payrollId: uuid('payroll_id')
    .notNull()
    .references(() => payrolls.id),
  employeeId: uuid('employee_id')
    .notNull()
    .references(() => employees.id),
  grossAmount: varchar('gross_amount', { length: 20 }).notNull().default('0'),
  deductions: varchar('deductions', { length: 20 }).notNull().default('0'),
  netAmount: varchar('net_amount', { length: 20 }).notNull().default('0'),
  // Array of { code, name, amount, type }
  concepts: jsonb('concepts').notNull().default([]),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const loans = pgTable('loans', {
  id: uuid('id').defaultRandom().primaryKey(),
  employeeId: uuid('employee_id')
    .notNull()
    .references(() => employees.id),
  amount: varchar('amount', { length: 20 }).notNull(),
  balance: varchar('balance', { length: 20 }).notNull(),
  installment: varchar('installment', { length: 20 }).notNull(),
  startDate: date('start_date').notNull(),
  endDate: date('end_date'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export type Concept = typeof concepts.$inferSelect
export type NewConcept = typeof concepts.$inferInsert
export type Payroll = typeof payrolls.$inferSelect
export type NewPayroll = typeof payrolls.$inferInsert
export type PayrollLine = typeof payrollLines.$inferSelect
export type Loan = typeof loans.$inferSelect
export type NewLoan = typeof loans.$inferInsert
