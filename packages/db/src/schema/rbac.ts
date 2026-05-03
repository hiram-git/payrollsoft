import { sql } from 'drizzle-orm'
import {
  bigserial,
  boolean,
  index,
  inet,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'
import { payrollAuth, superAdmins, tenants } from './tenant'
import { users } from './users'

// ─── Tenant-scoped RBAC ──────────────────────────────────────────────────────

export const roles = pgTable('roles', {
  id: uuid('id').defaultRandom().primaryKey(),
  code: varchar('code', { length: 50 }).notNull().unique(),
  name: varchar('name', { length: 120 }).notNull(),
  description: text('description'),
  isSystem: boolean('is_system').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const rolePermissions = pgTable(
  'role_permissions',
  {
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    permissionCode: varchar('permission_code', { length: 80 }).notNull(),
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.roleId, t.permissionCode] }),
    codeIdx: index('role_permissions_code_idx').on(t.permissionCode),
  })
)

export const roleInheritance = pgTable(
  'role_inheritance',
  {
    parentRoleId: uuid('parent_role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    childRoleId: uuid('child_role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.parentRoleId, t.childRoleId] }),
    childIdx: index('role_inheritance_child_idx').on(t.childRoleId),
  })
)

export const userRoles = pgTable(
  'user_roles',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.roleId] }),
    roleIdx: index('user_roles_role_idx').on(t.roleId),
  })
)

export const auditLog = pgTable(
  'audit_log',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: uuid('user_id'),
    userEmail: varchar('user_email', { length: 255 }),
    action: varchar('action', { length: 80 }).notNull(),
    entity: varchar('entity', { length: 40 }),
    entityId: varchar('entity_id', { length: 64 }),
    payload: jsonb('payload').notNull().default({}),
    ipAddress: inet('ip_address'),
    userAgent: varchar('user_agent', { length: 255 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    createdAtIdx: index('audit_log_created_at_idx').on(sql`${t.createdAt} DESC`),
    userIdx: index('audit_log_user_id_idx').on(t.userId),
    actionIdx: index('audit_log_action_idx').on(t.action),
    entityIdx: index('audit_log_entity_idx').on(t.entity, t.entityId),
  })
)

export type Role = typeof roles.$inferSelect
export type NewRole = typeof roles.$inferInsert
export type RolePermission = typeof rolePermissions.$inferSelect
export type RoleInheritance = typeof roleInheritance.$inferSelect
export type UserRoleAssignment = typeof userRoles.$inferSelect
export type AuditLogEntry = typeof auditLog.$inferSelect
export type NewAuditLogEntry = typeof auditLog.$inferInsert

// ─── Central audit / provisioning (payroll_auth) ─────────────────────────────

export const superAdminAudit = payrollAuth.table(
  'super_admin_audit',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    superAdminId: uuid('super_admin_id').references(() => superAdmins.id, {
      onDelete: 'set null',
    }),
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'set null' }),
    action: varchar('action', { length: 80 }).notNull(),
    payload: jsonb('payload').notNull().default({}),
    ipAddress: inet('ip_address'),
    userAgent: varchar('user_agent', { length: 255 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    createdAtIdx: index('super_admin_audit_created_at_idx').on(sql`${t.createdAt} DESC`),
    tenantIdx: index('super_admin_audit_tenant_idx').on(t.tenantId),
    actionIdx: index('super_admin_audit_action_idx').on(t.action),
  })
)

export const tenantProvisioning = payrollAuth.table('tenant_provisioning', {
  tenantId: uuid('tenant_id')
    .primaryKey()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  state: varchar('state', { length: 20 }).notNull().default('pending'),
  error: text('error'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
})

export type SuperAdminAudit = typeof superAdminAudit.$inferSelect
export type NewSuperAdminAudit = typeof superAdminAudit.$inferInsert
export type TenantProvisioning = typeof tenantProvisioning.$inferSelect
export type NewTenantProvisioning = typeof tenantProvisioning.$inferInsert

export type ProvisioningState = 'pending' | 'running' | 'done' | 'failed'
