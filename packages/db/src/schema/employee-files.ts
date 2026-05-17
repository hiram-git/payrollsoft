import {
  date,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'

/**
 * Catálogo de tipos de expediente (Estudios Académicos, Capacitación,
 * Permisos, etc.). 13 entradas seedeadas por la migración base; los
 * tenants pueden agregar más usando códigos snake-case.
 *
 * `code` es estable (snake-case) y se usa para resolver la config de
 * campos dinámicos en `dynamic-fields.ts`. `id` se usa en el
 * correlativo (`T{id:3}-S{subtype:3}-...`).
 */
export const employeeFileTypes = pgTable('employee_file_types', {
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  code: varchar('code', { length: 60 }).notNull().unique(),
  name: varchar('name', { length: 120 }).notNull(),
  description: text('description'),
  sortOrder: integer('sort_order').notNull().default(0),
  isActive: integer('is_active').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const employeeFileSubtypes = pgTable(
  'employee_file_subtypes',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    typeId: integer('type_id').notNull(),
    code: varchar('code', { length: 60 }).notNull(),
    name: varchar('name', { length: 160 }).notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: integer('is_active').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    typeCodeUnique: uniqueIndex('employee_file_subtypes_type_code_unique').on(t.typeId, t.code),
    typeIdx: index('employee_file_subtypes_type_idx').on(t.typeId),
  })
)

/**
 * Expediente del empleado — un registro por documento/movimiento.
 *
 *   document_year / document_sequence se completan al crear vía
 *   `createEmployeeFileWithCorrelative` (transacción + FOR UPDATE).
 *   El correlativo formateado vive en `document_number` para que las
 *   búsquedas por número exacto sean directas.
 *
 *   extra_fields lleva los campos específicos por tipo/subtipo
 *   (definidos en `dynamic-fields.ts`). Los valores de `type='file'`
 *   NO se guardan aquí — esos van como filas en attachments con
 *   `label = nombre del campo`.
 */
export const employeeFiles = pgTable(
  'employee_files',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    employeeId: uuid('employee_id').notNull(),
    typeId: integer('type_id').notNull(),
    subtypeId: integer('subtype_id').notNull(),
    documentDate: date('document_date').notNull(),
    documentYear: smallint('document_year').notNull(),
    documentSequence: integer('document_sequence').notNull(),
    documentNumber: varchar('document_number', { length: 120 }).notNull(),
    observations: text('observations'),
    extraFields: jsonb('extra_fields').notNull().default({}),
    /** Estado del workflow: 'pending' | 'approved' | 'rejected'. */
    approvalStatus: varchar('approval_status', { length: 20 }).notNull().default('approved'),
    approvedBy: uuid('approved_by'),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    rejectionReason: text('rejection_reason'),
    createdBy: uuid('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    employeeIdx: index('employee_files_employee_idx').on(t.employeeId),
    correlativeIdx: index('employee_files_correlative_idx').on(
      t.typeId,
      t.subtypeId,
      t.documentYear,
      t.documentSequence
    ),
    docNumberIdx: uniqueIndex('employee_files_document_number_unique').on(t.documentNumber),
  })
)

/**
 * Adjuntos de un expediente. `label` vale `'adjunto'` para los
 * archivos cargados vía el campo genérico `attachments[]`, o el
 * nombre del campo (`title_file`, `medical_file`, etc.) para los
 * que vienen de un `type='file'` del config dinámico.
 *
 * `file_path` es la ruta relativa al directorio de storage del
 * tenant (ver `EMPLOYEE_FILES_DIR` en la API). Se elimina del
 * disco al borrar el expediente padre.
 */
export const employeeFileAttachments = pgTable(
  'employee_file_attachments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    employeeFileId: uuid('employee_file_id').notNull(),
    label: varchar('label', { length: 60 }).notNull().default('adjunto'),
    filePath: varchar('file_path', { length: 500 }).notNull(),
    originalName: varchar('original_name', { length: 255 }).notNull(),
    mimeType: varchar('mime_type', { length: 100 }).notNull(),
    fileSize: integer('file_size').notNull(),
    uploadedBy: uuid('uploaded_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    fileIdx: index('employee_file_attachments_file_idx').on(t.employeeFileId),
  })
)

/**
 * Catálogo de reglas de aprobación. Cada fila declara qué rol
 * (`approver_role`) puede aprobar expedientes de un determinado
 * (typeId, subtypeId). Si `subtypeId` es null, la regla aplica a
 * todos los subtipos del tipo; una regla más específica con
 * `subtypeId` definido prevalece sobre la genérica.
 */
export const employeeFileApprovalRules = pgTable('employee_file_approval_rules', {
  id: uuid('id').defaultRandom().primaryKey(),
  typeId: integer('type_id').notNull(),
  subtypeId: integer('subtype_id'),
  approverRole: varchar('approver_role', { length: 50 }).notNull(),
  isActive: integer('is_active').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export type EmployeeFileType = typeof employeeFileTypes.$inferSelect
export type EmployeeFileSubtype = typeof employeeFileSubtypes.$inferSelect
export type EmployeeFile = typeof employeeFiles.$inferSelect
export type NewEmployeeFile = typeof employeeFiles.$inferInsert
export type EmployeeFileAttachment = typeof employeeFileAttachments.$inferSelect
export type NewEmployeeFileAttachment = typeof employeeFileAttachments.$inferInsert
export type EmployeeFileApprovalRule = typeof employeeFileApprovalRules.$inferSelect
export type NewEmployeeFileApprovalRule = typeof employeeFileApprovalRules.$inferInsert
