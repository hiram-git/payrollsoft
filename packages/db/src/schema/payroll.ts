import {
  boolean,
  date,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'

export const payrollAcumulados = pgTable('payroll_acumulados', {
  id: uuid('id').defaultRandom().primaryKey(),
  payrollId: uuid('payroll_id').notNull(),
  employeeId: uuid('employee_id').notNull(),
  conceptCode: varchar('concept_code', { length: 20 }).notNull(),
  conceptName: varchar('concept_name', { length: 255 }).notNull(),
  conceptType: varchar('concept_type', { length: 20 }).notNull(), // income | deduction
  amount: varchar('amount', { length: 20 }).notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const concepts = pgTable('concepts', {
  id: uuid('id').defaultRandom().primaryKey(),
  code: varchar('code', { length: 20 }).notNull().unique(),
  name: varchar('name', { length: 255 }).notNull(),
  type: varchar('type', { length: 20 }).notNull(), // income | deduction | patronal
  formula: text('formula'),
  isActive: boolean('is_active').notNull().default(true),
  // Unit of measure
  unit: varchar('unit', { length: 20 }).notNull().default('amount'), // amount | hours | percentage | days
  // Behavior flags
  printDetails: boolean('print_details').notNull().default(false),
  prorates: boolean('prorates').notNull().default(false),
  allowModify: boolean('allow_modify').notNull().default(false),
  isReferenceValue: boolean('is_reference_value').notNull().default(false),
  useAmountCalc: boolean('use_amount_calc').notNull().default(false),
  allowZero: boolean('allow_zero').notNull().default(false),
  cuentaContableId: uuid('cuenta_contable_id'),
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
  status: varchar('status', { length: 20 }).notNull().default('created'),
  totalGross: varchar('total_gross', { length: 20 }).notNull().default('0'),
  totalDeductions: varchar('total_deductions', { length: 20 }).notNull().default('0'),
  totalNet: varchar('total_net', { length: 20 }).notNull().default('0'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const payrollLines = pgTable('payroll_lines', {
  id: uuid('id').defaultRandom().primaryKey(),
  payrollId: uuid('payroll_id').notNull(),
  employeeId: uuid('employee_id').notNull(),
  grossAmount: varchar('gross_amount', { length: 20 }).notNull().default('0'),
  deductions: varchar('deductions', { length: 20 }).notNull().default('0'),
  netAmount: varchar('net_amount', { length: 20 }).notNull().default('0'),
  // Array of { code, name, amount, type }
  concepts: jsonb('concepts').notNull().default([]),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const creditors = pgTable('creditors', {
  id: uuid('id').defaultRandom().primaryKey(),
  code: varchar('code', { length: 20 }).notNull().unique(),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  /** UUID of the deduction concept auto-created for this creditor */
  conceptId: uuid('concept_id'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const loans = pgTable('loans', {
  id: uuid('id').defaultRandom().primaryKey(),
  employeeId: uuid('employee_id').notNull(),
  creditorId: uuid('creditor_id'), // optional FK to creditors
  amount: varchar('amount', { length: 20 }).notNull(),
  balance: varchar('balance', { length: 20 }).notNull(),
  installment: varchar('installment', { length: 20 }).notNull(),
  startDate: date('start_date').notNull(),
  endDate: date('end_date'),
  isActive: boolean('is_active').notNull().default(true),
  loanType: varchar('loan_type', { length: 50 }),
  frequency: varchar('frequency', { length: 20 }),
  creditor: varchar('creditor', { length: 255 }),
  allowDecember: boolean('allow_december').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const loanInstallments = pgTable('loan_installments', {
  id: uuid('id').defaultRandom().primaryKey(),
  loanId: uuid('loan_id').notNull(),
  installmentNumber: integer('installment_number').notNull(),
  amount: varchar('amount', { length: 20 }).notNull(),
  dueDate: date('due_date'),
  status: varchar('status', { length: 20 }).notNull().default('pending'), // pending | paid
  payrollId: uuid('payroll_id'), // filled when paid on payroll close
  paidAt: timestamp('paid_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export type Concept = typeof concepts.$inferSelect
export type NewConcept = typeof concepts.$inferInsert
export type Payroll = typeof payrolls.$inferSelect
export type NewPayroll = typeof payrolls.$inferInsert
export type PayrollLine = typeof payrollLines.$inferSelect
export type Loan = typeof loans.$inferSelect
export type NewLoan = typeof loans.$inferInsert
export type PayrollAcumulado = typeof payrollAcumulados.$inferSelect
export type NewPayrollAcumulado = typeof payrollAcumulados.$inferInsert
export type Creditor = typeof creditors.$inferSelect
export type NewCreditor = typeof creditors.$inferInsert
export type LoanInstallment = typeof loanInstallments.$inferSelect
export type NewLoanInstallment = typeof loanInstallments.$inferInsert
