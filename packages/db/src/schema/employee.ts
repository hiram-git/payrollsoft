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
  secondName: varchar('second_name', { length: 100 }),
  lastName: varchar('last_name', { length: 100 }).notNull(),
  secondSurname: varchar('second_surname', { length: 100 }),
  marriedSurname: varchar('married_surname', { length: 100 }),
  idNumber: varchar('id_number', { length: 20 }).notNull().unique(),
  idPrefix: varchar('id_prefix', { length: 5 }),
  idProvince: varchar('id_province', { length: 5 }),
  idVolume: varchar('id_volume', { length: 10 }),
  idFolio: varchar('id_folio', { length: 10 }),
  scannedId: text('scanned_id'),
  socialSecurityNumber: varchar('social_security_number', { length: 20 }),
  sex: varchar('sex', { length: 10 }),
  maritalStatus: varchar('marital_status', { length: 20 }),
  nationality: varchar('nationality', { length: 30 }),
  birthDate: date('birth_date'),
  birthPlace: varchar('birth_place', { length: 255 }),
  email: varchar('email', { length: 255 }),
  personalEmail: varchar('personal_email', { length: 255 }),
  phone: varchar('phone', { length: 20 }),
  addressProvince: varchar('address_province', { length: 100 }),
  addressDistrict: varchar('address_district', { length: 100 }),
  addressTownship: varchar('address_township', { length: 100 }),
  address: varchar('address', { length: 500 }),
  otherAddress: varchar('other_address', { length: 500 }),
  jobTitleId: uuid('job_title_id'),
  jobFunctionId: uuid('job_function_id'),
  departmentId: uuid('department_id'),
  positionId: uuid('position_id'),
  position: varchar('position', { length: 100 }),
  department: varchar('department', { length: 100 }),
  hireDate: date('hire_date').notNull(),
  terminationDate: date('termination_date'),
  decreeNumber: varchar('decree_number', { length: 50 }),
  resolutionNumber: varchar('resolution_number', { length: 50 }),
  decreeDate: date('decree_date'),
  resolutionDate: date('resolution_date'),
  collaboratorNumber: varchar('collaborator_number', { length: 20 }),
  externalUserRef: varchar('external_user_ref', { length: 100 }),
  contractType: varchar('contract_type', { length: 40 }),
  contractEndDate: date('contract_end_date'),
  irKey: varchar('ir_key', { length: 20 }),
  shiftId: uuid('shift_id'),
  weeklyBaseHours: varchar('weekly_base_hours', { length: 10 }),
  observations: text('observations'),
  terminationDecree: varchar('termination_decree', { length: 50 }),
  terminationResolution: varchar('termination_resolution', { length: 50 }),
  terminationDecreeDate: date('termination_decree_date'),
  terminationResolutionDate: date('termination_resolution_date'),
  terminationReason: varchar('termination_reason', { length: 255 }),
  baseSalary: varchar('base_salary', { length: 20 }).notNull(),
  payFrequency: varchar('pay_frequency', { length: 20 }).notNull().default('biweekly'),
  bankId: uuid('bank_id'),
  accountNumber: varchar('account_number', { length: 40 }),
  accountType: varchar('account_type', { length: 20 }),
  paymentMethod: varchar('payment_method', { length: 10 }).notNull().default('check'),
  siacapPct: varchar('siacap_pct', { length: 10 }),
  photo: text('photo'),
  // Personal flags (Phase 2.D). has_own_disability drives the own-disability
  // time balance; requires_attendance_marking gates the time-clock/facial flow.
  hasOwnDisability: boolean('has_own_disability').notNull().default(false),
  requiresAttendanceMarking: boolean('requires_attendance_marking').notNull().default(true),
  canRead: boolean('can_read').notNull().default(false),
  canWrite: boolean('can_write').notNull().default(false),
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
