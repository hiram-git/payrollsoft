import { boolean, jsonb, pgSchema, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'

/**
 * Central auth schema — global, cross-tenant tables for tenants, super admins,
 * and the RBAC catalog. Lives outside any tenant_<slug> schema.
 */
export const payrollAuth = pgSchema('payroll_auth')

export const tenants = payrollAuth.table('tenants', {
  id: uuid('id').defaultRandom().primaryKey(),
  slug: varchar('slug', { length: 50 }).notNull().unique(),
  name: varchar('name', { length: 255 }).notNull(),
  databaseSchema: varchar('database_schema', { length: 100 }).notNull(),
  status: varchar('status', { length: 20 }).notNull().default('PROVISIONING'),
  contactEmail: varchar('contact_email', { length: 255 }),
  metadata: jsonb('metadata').notNull().default({}),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  archivedAt: timestamp('archived_at'),
})

export const superAdmins = payrollAuth.table('super_admins', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export type Tenant = typeof tenants.$inferSelect
export type NewTenant = typeof tenants.$inferInsert
export type SuperAdmin = typeof superAdmins.$inferSelect
export type NewSuperAdmin = typeof superAdmins.$inferInsert
