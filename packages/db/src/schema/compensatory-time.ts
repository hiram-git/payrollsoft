import {
  bigserial,
  date,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'

export const compensatoryTimeBalances = pgTable(
  'compensatory_time_balances',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    employeeId: uuid('employee_id').notNull(),
    pool: varchar('pool', { length: 30 }).notNull(),
    earned: numeric('earned', { precision: 8, scale: 2 }).notNull().default('0'),
    used: numeric('used', { precision: 8, scale: 2 }).notNull().default('0'),
    reserved: numeric('reserved', { precision: 8, scale: 2 }).notNull().default('0'),
    year: integer('year').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    employeePoolYearUnique: uniqueIndex('comp_time_bal_emp_pool_year_unique').on(
      t.employeeId,
      t.pool,
      t.year
    ),
    employeeIdx: index('comp_time_bal_employee_idx').on(t.employeeId),
  })
)

export const compensatoryTimeMovements = pgTable(
  'compensatory_time_movements',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    employeeId: uuid('employee_id').notNull(),
    pool: varchar('pool', { length: 30 }).notNull(),
    movementType: varchar('movement_type', { length: 30 }).notNull(),
    hours: numeric('hours', { precision: 8, scale: 2 }).notNull(),
    balanceBefore: numeric('balance_before', { precision: 8, scale: 2 }).notNull(),
    balanceAfter: numeric('balance_after', { precision: 8, scale: 2 }).notNull(),
    referenceType: varchar('reference_type', { length: 30 }),
    referenceId: uuid('reference_id'),
    notes: text('notes'),
    performedBy: uuid('performed_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    employeeIdx: index('comp_time_mov_employee_idx').on(t.employeeId, t.createdAt),
    referenceIdx: index('comp_time_mov_reference_idx').on(t.referenceType, t.referenceId),
  })
)

export type CompensatoryTimeBalance = typeof compensatoryTimeBalances.$inferSelect
export type NewCompensatoryTimeBalance = typeof compensatoryTimeBalances.$inferInsert
export type CompensatoryTimeMovement = typeof compensatoryTimeMovements.$inferSelect
export type NewCompensatoryTimeMovement = typeof compensatoryTimeMovements.$inferInsert

export type CompensatoryPool = 'compensatory' | 'disability' | 'family_disability'
export type CompensatoryMovementType =
  | 'initialization'
  | 'overtime'
  | 'absence'
  | 'lateness'
  | 'permission'
  | 'birthday'
  | 'adjustment'
