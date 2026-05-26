import { boolean, date, index, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'

export const dependents = pgTable(
  'dependents',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    employeeId: uuid('employee_id').notNull(),
    firstName: varchar('first_name', { length: 100 }).notNull(),
    lastName: varchar('last_name', { length: 100 }).notNull(),
    idNumber: varchar('id_number', { length: 20 }),
    relationship: varchar('relationship', { length: 30 }).notNull().default('other'),
    birthDate: date('birth_date'),
    sex: varchar('sex', { length: 10 }),
    hasDisability: boolean('has_disability').notNull().default(false),
    disabilityDescription: text('disability_description'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    employeeIdx: index('dependents_employee_idx').on(t.employeeId),
  })
)

export type Dependent = typeof dependents.$inferSelect
export type NewDependent = typeof dependents.$inferInsert
