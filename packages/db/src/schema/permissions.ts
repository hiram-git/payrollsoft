import { boolean, index, text, timestamp, varchar } from 'drizzle-orm/pg-core'
import { payrollAuth } from './tenant'

/**
 * Master catalog of permission codes — shared across all tenants. Lives in
 * the central payroll_auth schema; tenants reference rows by string code in
 * their own role_permissions tables.
 *
 * Codes follow `<module>:<action>[.<sub_action>]`, validated by both a CHECK
 * constraint in the migration and the application layer.
 */
export const permissionsCatalog = payrollAuth.table(
  'permissions_catalog',
  {
    code: varchar('code', { length: 80 }).primaryKey(),
    module: varchar('module', { length: 40 }).notNull(),
    action: varchar('action', { length: 40 }).notNull(),
    scope: varchar('scope', { length: 20 }).notNull().default('tenant'),
    description: text('description').notNull(),
    isDangerous: boolean('is_dangerous').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    moduleIdx: index('permissions_catalog_module_idx').on(t.module),
    scopeIdx: index('permissions_catalog_scope_idx').on(t.scope),
  })
)

export type Permission = typeof permissionsCatalog.$inferSelect
export type NewPermission = typeof permissionsCatalog.$inferInsert

export type PermissionScope = 'tenant' | 'global'
