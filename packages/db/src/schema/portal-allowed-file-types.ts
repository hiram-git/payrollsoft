import { index, integer, pgTable, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'

export const portalAllowedFileTypes = pgTable(
  'portal_allowed_file_types',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    employeeId: uuid('employee_id').notNull(),
    typeId: integer('type_id').notNull(),
    subtypeId: integer('subtype_id'),
    grantedBy: uuid('granted_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    employeeTypeUnique: uniqueIndex('portal_allowed_ft_emp_type_sub').on(
      t.employeeId,
      t.typeId,
      t.subtypeId
    ),
    employeeIdx: index('portal_allowed_ft_employee_idx').on(t.employeeId),
  })
)

export type PortalAllowedFileType = typeof portalAllowedFileTypes.$inferSelect
