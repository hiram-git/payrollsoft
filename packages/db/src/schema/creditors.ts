import { boolean, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'
import { pgTable } from 'drizzle-orm/pg-core'

export const creditors = pgTable('creditors', {
  id: uuid('id').defaultRandom().primaryKey(),
  code: varchar('code', { length: 20 }).notNull().unique(),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  /** The deduction concept code auto-created for this creditor */
  conceptCode: varchar('concept_code', { length: 20 }),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export type Creditor = typeof creditors.$inferSelect
export type NewCreditor = typeof creditors.$inferInsert
