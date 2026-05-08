import {
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'

/**
 * Catálogo de campos adicionales por tenant.
 *
 * Los valores por empleado siguen viviendo en `employees.custom_fields`
 * (jsonb) — esta tabla es solo el catálogo: la UI la usa para saber
 * qué campos renderizar y la API la usa para validar tipos al guardar.
 *
 * `field_type` está restringido a {text, integer, float, date} vía
 * CHECK en la migración. `default_value` y `validation_rules` se
 * dejan como jsonb genéricos para no tener que migrar el schema cada
 * vez que aparezca una validación nueva (min/max/regex/etc).
 */
export const customFieldDefinitions = pgTable('custom_field_definitions', {
  id: uuid('id').defaultRandom().primaryKey(),
  code: varchar('code', { length: 50 }).notNull().unique(),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  fieldType: varchar('field_type', { length: 20 }).notNull(),
  isRequired: boolean('is_required').notNull().default(false),
  defaultValue: jsonb('default_value'),
  validationRules: jsonb('validation_rules').notNull().default({}),
  sortOrder: integer('sort_order').notNull().default(0),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export type CustomFieldDefinition = typeof customFieldDefinitions.$inferSelect
export type NewCustomFieldDefinition = typeof customFieldDefinitions.$inferInsert

/**
 * Historial de cambios de valores de campos adicionales por empleado.
 * Append-only: cada cambio inserta una fila con el valor anterior,
 * el nuevo y quién lo modificó. Permite auditar fácil sin tocar el
 * jsonb del empleado.
 */
export const customFieldValueHistory = pgTable('custom_field_value_history', {
  id: uuid('id').defaultRandom().primaryKey(),
  employeeId: uuid('employee_id').notNull(),
  fieldCode: varchar('field_code', { length: 50 }).notNull(),
  oldValue: jsonb('old_value'),
  newValue: jsonb('new_value'),
  changedBy: uuid('changed_by'),
  changedAt: timestamp('changed_at', { withTimezone: true }).notNull().defaultNow(),
})

export type CustomFieldValueHistory = typeof customFieldValueHistory.$inferSelect
export type NewCustomFieldValueHistory = typeof customFieldValueHistory.$inferInsert

export const CUSTOM_FIELD_TYPES = ['text', 'integer', 'float', 'date'] as const
export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number]

export const CUSTOM_FIELD_TYPE_LABELS: Record<CustomFieldType, string> = {
  text: 'Texto',
  integer: 'Número entero',
  float: 'Número decimal',
  date: 'Fecha',
}
