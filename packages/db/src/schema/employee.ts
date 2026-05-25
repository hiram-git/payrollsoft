import {
  boolean,
  date,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'

export const employees = pgTable('employees', {
  id: uuid('id').defaultRandom().primaryKey(),
  code: varchar('code', { length: 50 }).notNull().unique(),
  firstName: varchar('first_name', { length: 100 }).notNull(),
  lastName: varchar('last_name', { length: 100 }).notNull(),
  idNumber: varchar('id_number', { length: 20 }).notNull().unique(), // Cédula panameña
  socialSecurityNumber: varchar('social_security_number', { length: 20 }),
  email: varchar('email', { length: 255 }),
  phone: varchar('phone', { length: 20 }),
  // Catalog links (no .references() — multi-tenant search_path incompatibility)
  jobTitleId: uuid('job_title_id'),
  jobFunctionId: uuid('job_function_id'),
  departmentId: uuid('department_id'),
  positionId: uuid('position_id'), // NO .references() — multi-tenant
  // Denormalized text copies for display (auto-set from catalog on save)
  position: varchar('position', { length: 100 }),
  department: varchar('department', { length: 100 }),
  hireDate: date('hire_date').notNull(),
  terminationDate: date('termination_date'),
  // Stored as string to avoid floating-point precision issues in salary math
  baseSalary: varchar('base_salary', { length: 20 }).notNull(),
  payFrequency: varchar('pay_frequency', { length: 20 }).notNull().default('biweekly'),
  // ── Datos bancarios para tesorería ────────────────────────────────────
  // `paymentMethod` determina cómo se paga al empleado. `bankId`,
  // `accountNumber` y `accountType` solo son obligatorios cuando es 'ach'.
  bankId: uuid('bank_id'),
  accountNumber: varchar('account_number', { length: 40 }),
  /** 'savings' | 'checking' — null si paymentMethod != 'ach' */
  accountType: varchar('account_type', { length: 20 }),
  /** 'ach' | 'check' | 'cash' */
  paymentMethod: varchar('payment_method', { length: 10 }).notNull().default('check'),
  photo: text('photo'),
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

// ─── Many-to-Many: Employee ↔ Payroll Type ────────────────────────────────────

export const employeePayrollTypes = pgTable(
  'employee_payroll_types',
  {
    employeeId: uuid('employee_id').notNull(),
    payrollTypeId: uuid('payroll_type_id').notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.employeeId, t.payrollTypeId] }) })
)

export type Employee = typeof employees.$inferSelect
export type NewEmployee = typeof employees.$inferInsert
export type EmployeeDocument = typeof employeeDocuments.$inferSelect
export type EmployeePayrollTypeLink = typeof employeePayrollTypes.$inferSelect
