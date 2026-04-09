import { boolean, date, jsonb, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'

export const employees = pgTable('employees', {
  id: uuid('id').defaultRandom().primaryKey(),
  code: varchar('code', { length: 50 }).notNull().unique(),
  firstName: varchar('first_name', { length: 100 }).notNull(),
  lastName: varchar('last_name', { length: 100 }).notNull(),
  idNumber: varchar('id_number', { length: 20 }).notNull().unique(), // Cédula panameña
  socialSecurityNumber: varchar('social_security_number', { length: 20 }),
  email: varchar('email', { length: 255 }),
  phone: varchar('phone', { length: 20 }),
  position: varchar('position', { length: 100 }),
  department: varchar('department', { length: 100 }),
  hireDate: date('hire_date').notNull(),
  terminationDate: date('termination_date'),
  // Stored as string to avoid floating-point precision issues in salary math
  baseSalary: varchar('base_salary', { length: 20 }).notNull(),
  payFrequency: varchar('pay_frequency', { length: 20 }).notNull().default('biweekly'),
  isActive: boolean('is_active').notNull().default(true),
  customFields: jsonb('custom_fields').default({}),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const employeeDocuments = pgTable('employee_documents', {
  id: uuid('id').defaultRandom().primaryKey(),
  employeeId: uuid('employee_id').notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  type: varchar('type', { length: 50 }).notNull(), // contract, id, other
  url: varchar('url', { length: 1000 }).notNull(),
  uploadedAt: timestamp('uploaded_at').notNull().defaultNow(),
})

export type Employee = typeof employees.$inferSelect
export type NewEmployee = typeof employees.$inferInsert
export type EmployeeDocument = typeof employeeDocuments.$inferSelect
