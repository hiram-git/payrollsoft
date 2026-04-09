import { boolean, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'

/**
 * Tenant-scoped users table.
 * Each tenant has its own users in their schema (tenant_{slug}).
 * Super admins are stored separately in the public schema (see tenant.ts).
 */
export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  role: varchar('role', { length: 20 }).notNull().default('VIEWER'),
  isActive: boolean('is_active').notNull().default(true),
  lastLoginAt: timestamp('last_login_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert

/** Role hierarchy for authorization checks */
export const ROLE_HIERARCHY: Record<string, number> = {
  SUPER_ADMIN: 100,
  ADMIN: 80,
  HR: 60,
  ACCOUNTANT: 40,
  VIEWER: 20,
}

/** Returns true if `userRole` has at least the permissions of `requiredRole` */
export function hasRole(userRole: string, requiredRole: string): boolean {
  return (ROLE_HIERARCHY[userRole] ?? 0) >= (ROLE_HIERARCHY[requiredRole] ?? 999)
}
