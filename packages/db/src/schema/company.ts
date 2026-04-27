import { boolean, integer, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'

export const companyConfig = pgTable('company_config', {
  id: uuid('id').defaultRandom().primaryKey(),
  // Basic info
  companyName: varchar('company_name', { length: 255 }),
  ruc: varchar('ruc', { length: 50 }),
  legalRepresentative: varchar('legal_representative', { length: 255 }),
  // Contact
  address: varchar('address', { length: 500 }),
  phone: varchar('phone', { length: 20 }),
  email: varchar('email', { length: 100 }),
  // Institution type: 'privada' (individual salaries) | 'publica' (position-based salaries)
  tipoInstitucion: varchar('tipo_institucion', { length: 20 }).notNull().default('privada'),
  // Currency
  currencyCode: varchar('currency_code', { length: 10 }).notNull().default('USD'),
  currencySymbol: varchar('currency_symbol', { length: 5 }).notNull().default('$'),
  // SMTP
  mailHost: varchar('mail_host', { length: 255 }),
  mailPort: integer('mail_port').notNull().default(587),
  mailEncryption: varchar('mail_encryption', { length: 10 }).notNull().default('tls'),
  mailUsername: varchar('mail_username', { length: 255 }),
  mailPassword: varchar('mail_password', { length: 255 }), // stored as-is; encrypt in production
  mailFromAddress: varchar('mail_from_address', { length: 255 }),
  mailFromName: varchar('mail_from_name', { length: 255 }),
  // Payroll report signatures
  elaboradoPor: varchar('elaborado_por', { length: 255 }),
  cargoElaborador: varchar('cargo_elaborador', { length: 255 }).default('Especialista en Nóminas'),
  jefeRecursosHumanos: varchar('jefe_recursos_humanos', { length: 255 }),
  cargoJefeRrhh: varchar('cargo_jefe_rrhh', { length: 255 }).default('Jefe de Recursos Humanos'),
  // Logos — stored as base64 data URLs (suitable for small company logos up to ~200 KB)
  logoEmpresa: text('logo_empresa'),
  logoIzquierdoReportes: text('logo_izquierdo_reportes'),
  logoDerechoReportes: text('logo_derecho_reportes'),
  // Per-tenant strategy for the Planilla PDF lifecycle:
  //   'on_demand'   — render every download (no storage; default).
  //   'file_storage' — render once, persist to R2; subsequent downloads
  //                    stream the stored object so the user gets the file
  //                    instantly. R2 credentials come from env vars.
  payrollReportMode: varchar('payroll_report_mode', { length: 20 }).notNull().default('on_demand'),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export type CompanyConfig = typeof companyConfig.$inferSelect
export type NewCompanyConfig = typeof companyConfig.$inferInsert
