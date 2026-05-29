import { date, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

/**
 * Temporary delegation of an approver's identity for a single approval step.
 *
 * This is NOT a multi-level approval chain — it is substitutable identity:
 * while a delegation is active for a date, anyone resolving the delegator's
 * approvals acts through the delegate instead. `resolveApprover()` reads this.
 *
 * Tenant-scoped. FK columns intentionally without .references() (schema-per-
 * tenant; the referenced users live in the same tenant schema).
 */
export const approvalDelegations = pgTable(
  'approval_delegations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    delegatorUserId: uuid('delegator_user_id').notNull(),
    delegateUserId: uuid('delegate_user_id').notNull(),
    validFrom: date('valid_from').notNull(),
    validTo: date('valid_to').notNull(),
    reason: text('reason'),
    createdBy: uuid('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    delegatorIdx: index('approval_delegations_delegator_idx').on(t.delegatorUserId),
    rangeIdx: index('approval_delegations_range_idx').on(t.validFrom, t.validTo),
  })
)

export type ApprovalDelegation = typeof approvalDelegations.$inferSelect
export type NewApprovalDelegation = typeof approvalDelegations.$inferInsert
