import { boolean, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'

export const positions = pgTable('positions', {
  id: uuid('id').defaultRandom().primaryKey(),
  code: varchar('code', { length: 20 }).notNull().unique(),
  name: varchar('name', { length: 255 }).notNull(),
  salary: varchar('salary', { length: 20 }).notNull().default('0'),
  jobTitleId: uuid('job_title_id'),
  departmentId: uuid('department_id'),
  jobFunctionId: uuid('job_function_id'),
  budgetItemId: uuid('budget_item_id'),
  isActive: boolean('is_active').notNull().default(true),
  status: varchar('status', { length: 20 }).notNull().default('vacante'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export type Position = typeof positions.$inferSelect
export type NewPosition = typeof positions.$inferInsert
