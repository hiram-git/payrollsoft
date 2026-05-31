import { boolean, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'

export const positions = pgTable('positions', {
  id: uuid('id').defaultRandom().primaryKey(),
  code: varchar('code', { length: 20 }).notNull().unique(),
  name: varchar('name', { length: 255 }).notNull(),
  salary: varchar('salary', { length: 20 }).notNull().default('0'),
  // Additional public-sector salary concepts (amounts). The payroll engine
  // does NOT consume these yet — their fiscal treatment is pending.
  overtimeAmount: varchar('overtime_amount', { length: 20 }).notNull().default('0'),
  representationAmount: varchar('representation_amount', { length: 20 }).notNull().default('0'),
  jobTitleId: uuid('job_title_id'),
  departmentId: uuid('department_id'),
  jobFunctionId: uuid('job_function_id'),
  // Budget items (partidas) per concept: base salary, overtime, representation
  // and the thirteenth-month payment can each draw from a different partida.
  budgetItemId: uuid('budget_item_id'),
  overtimeBudgetItemId: uuid('overtime_budget_item_id'),
  representationBudgetItemId: uuid('representation_budget_item_id'),
  thirteenthMonthBudgetItemId: uuid('thirteenth_month_budget_item_id'),
  isActive: boolean('is_active').notNull().default(true),
  status: varchar('status', { length: 20 }).notNull().default('vacante'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export type Position = typeof positions.$inferSelect
export type NewPosition = typeof positions.$inferInsert
