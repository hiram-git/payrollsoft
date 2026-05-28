import { boolean, index, primaryKey, text, timestamp, varchar } from 'drizzle-orm/pg-core'
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

/**
 * Catálogo global de roles del sistema. El superadmin gestiona estos
 * roles desde `/superadmin/permissions`; cualquier alta o edición se
 * propaga a la tabla `roles` de cada tenant (upsert por `code`).
 *
 * Convención: `code` snake_case, único, sin espacios. `is_dangerous`
 * marca roles que conceden permisos sensibles para que la UI muestre
 * advertencias al asignarlos.
 */
export const systemRolesCatalog = payrollAuth.table('system_roles_catalog', {
  code: varchar('code', { length: 50 }).primaryKey(),
  name: varchar('name', { length: 120 }).notNull(),
  description: text('description'),
  isDangerous: boolean('is_dangerous').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

/**
 * Permisos asignados a cada rol del catálogo global. La propagación
 * replica este set tal cual en `role_permissions` de cada tenant.
 */
export const systemRolePermissions = payrollAuth.table(
  'system_role_permissions',
  {
    roleCode: varchar('role_code', { length: 50 }).notNull(),
    permissionCode: varchar('permission_code', { length: 80 }).notNull(),
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.roleCode, t.permissionCode] }),
    permIdx: index('system_role_permissions_perm_idx').on(t.permissionCode),
  })
)

export type SystemRole = typeof systemRolesCatalog.$inferSelect
export type NewSystemRole = typeof systemRolesCatalog.$inferInsert
export type SystemRolePermission = typeof systemRolePermissions.$inferSelect
