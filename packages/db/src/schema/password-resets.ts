import { pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'
import { users } from './users'

/**
 * Password reset tokens for the "forgot password" flow.
 *
 * The plaintext token is never stored — we keep its SHA-256 hash so a
 * dump of the table can't be replayed. Each row is single-use: once
 * `usedAt` is set, the token cannot be redeemed again. A short
 * `expiresAt` window (typically 30 min) further limits exposure.
 *
 * Lives in the same tenant schema as `users` so a tenant slug + token
 * pair fully scopes the lookup.
 */
export const passwordResets = pgTable('password_resets', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: varchar('token_hash', { length: 128 }).notNull().unique(),
  expiresAt: timestamp('expires_at').notNull(),
  usedAt: timestamp('used_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export type PasswordReset = typeof passwordResets.$inferSelect
export type NewPasswordReset = typeof passwordResets.$inferInsert
