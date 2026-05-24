import { boolean, integer, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'

/**
 * Credenciales del portal de colaboradores.
 *
 * Separada de `employees` para mantener integridad de datos. El login
 * del portal usa la cédula del empleado (employees.id_number) como
 * username y el password_hash de esta tabla.
 *
 * Los admins crean/resetean credenciales desde /config o un endpoint
 * dedicado. El JWT resultante tiene type='employee' (distinto del
 * type='user' de los usuarios admin).
 */
export const employeeCredentials = pgTable('employee_credentials', {
  id: uuid('id').defaultRandom().primaryKey(),
  employeeId: uuid('employee_id').notNull().unique(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  isActive: boolean('is_active').notNull().default(true),
  isLocked: boolean('is_locked').notNull().default(false),
  failedAttempts: integer('failed_attempts').notNull().default(0),
  isApprover: boolean('is_approver').notNull().default(false),
  mustChangePassword: boolean('must_change_password').notNull().default(true),
  resetToken: varchar('reset_token', { length: 255 }),
  resetTokenExpiresAt: timestamp('reset_token_expires_at', { withTimezone: true }),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  passwordChangedAt: timestamp('password_changed_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export type EmployeeCredential = typeof employeeCredentials.$inferSelect
export type NewEmployeeCredential = typeof employeeCredentials.$inferInsert
