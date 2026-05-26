import { index, jsonb, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'

export const tenantAuditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id'),
    userName: varchar('user_name', { length: 255 }),
    action: varchar('action', { length: 30 }).notNull(),
    entity: varchar('entity', { length: 60 }).notNull(),
    entityId: varchar('entity_id', { length: 255 }),
    changes: jsonb('changes').notNull().default({}),
    ipAddress: varchar('ip_address', { length: 45 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    entityIdx: index('audit_log_entity_idx').on(t.entity, t.entityId),
    userIdx: index('audit_log_user_idx').on(t.userId),
    createdIdx: index('audit_log_created_idx').on(t.createdAt),
  })
)

export type TenantAuditLogEntry = typeof tenantAuditLog.$inferSelect
export type NewTenantAuditLogEntry = typeof tenantAuditLog.$inferInsert
