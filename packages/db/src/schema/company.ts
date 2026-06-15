import { boolean, integer, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'

export const companyConfig = pgTable('company_config', {
  id: uuid('id').defaultRandom().primaryKey(),
  companyName: varchar('company_name', { length: 255 }),
  ruc: varchar('ruc', { length: 50 }),
  legalRepresentative: varchar('legal_representative', { length: 255 }),
  address: varchar('address', { length: 500 }),
  phone: varchar('phone', { length: 20 }),
  email: varchar('email', { length: 100 }),
  institutionType: varchar('institution_type', { length: 20 }).notNull().default('privada'),
  // Datos institucionales para reportes de gobierno / contraloría
  // (Nº patronal CSS, código y nombre de ministerio/entidad).
  patronalNumber: varchar('patronal_number', { length: 20 }),
  entityCode: varchar('entity_code', { length: 10 }),
  entityName: varchar('entity_name', { length: 255 }),
  currencyCode: varchar('currency_code', { length: 10 }).notNull().default('USD'),
  currencySymbol: varchar('currency_symbol', { length: 5 }).notNull().default('$'),
  mailHost: varchar('mail_host', { length: 255 }),
  mailPort: integer('mail_port').notNull().default(587),
  mailEncryption: varchar('mail_encryption', { length: 10 }).notNull().default('tls'),
  mailUsername: varchar('mail_username', { length: 255 }),
  mailPassword: varchar('mail_password', { length: 255 }),
  mailFromAddress: varchar('mail_from_address', { length: 255 }),
  mailFromName: varchar('mail_from_name', { length: 255 }),
  preparedBy: varchar('prepared_by', { length: 255 }),
  preparerTitle: varchar('preparer_title', { length: 255 }).default('Especialista en Planilla'),
  hrDirectorName: varchar('hr_director_name', { length: 255 }),
  hrDirectorTitle: varchar('hr_director_title', { length: 255 }).default(
    'Jefe de Recursos Humanos'
  ),
  companyLogo: text('company_logo'),
  reportLogoLeft: text('report_logo_left'),
  reportLogoRight: text('report_logo_right'),
  payrollReportMode: varchar('payroll_report_mode', { length: 20 }).notNull().default('on_demand'),
  absenceFileTypeId: integer('absence_file_type_id'),
  absenceFileSubtypeId: integer('absence_file_subtype_id'),
  latenessFileTypeId: integer('lateness_file_type_id'),
  latenessFileSubtypeId: integer('lateness_file_subtype_id'),
  portalNotificationsEnabled: boolean('portal_notifications_enabled').notNull().default(false),
  notifyOnRequestCreated: text('notify_on_request_created'),
  notifyOnRequestApproved: text('notify_on_request_approved'),
  notifyOnRequestRejected: text('notify_on_request_rejected'),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export type CompanyConfig = typeof companyConfig.$inferSelect
export type NewCompanyConfig = typeof companyConfig.$inferInsert
