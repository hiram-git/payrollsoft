import { boolean, index, pgTable, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core'

export const portalAccess = pgTable(
  'portal_access',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    employeeId: uuid('employee_id').notNull(),
    module: varchar('module', { length: 30 }).notNull(),
    isEnabled: boolean('is_enabled').notNull().default(true),
    grantedBy: uuid('granted_by'),
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    employeeModuleUnique: uniqueIndex('portal_access_employee_module_unique').on(
      t.employeeId,
      t.module
    ),
    employeeIdx: index('portal_access_employee_idx').on(t.employeeId),
  })
)

export type PortalAccess = typeof portalAccess.$inferSelect
export type NewPortalAccess = typeof portalAccess.$inferInsert

export const PORTAL_MODULES = ['requests', 'attendance', 'vacations', 'approvals'] as const
export type PortalModule = (typeof PORTAL_MODULES)[number]
