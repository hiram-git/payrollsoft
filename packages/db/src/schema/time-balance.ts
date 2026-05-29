import {
  bigserial,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'

/**
 * Cuenta de tiempo de un colaborador para un (tipo, año). El saldo NO se
 * almacena: se calcula sumando `amount_minutes` de sus movimientos.
 *
 *   balance_type ∈ compensatory | disability | family_disability
 */
export const timeBalances = pgTable(
  'time_balances',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    employeeId: uuid('employee_id').notNull(),
    balanceType: varchar('balance_type', { length: 30 }).notNull(),
    year: integer('year').notNull(),
    initialMinutes: integer('initial_minutes').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    empTypeYearUnique: uniqueIndex('time_balances_emp_type_year_uq').on(
      t.employeeId,
      t.balanceType,
      t.year
    ),
    employeeIdx: index('time_balances_employee_idx').on(t.employeeId),
  })
)

/**
 * Movimiento contable de una cuenta. `amount_minutes` positivo = crédito,
 * negativo = débito. El saldo del balance es la suma de estos.
 */
export const timeBalanceMovements = pgTable(
  'time_balance_movements',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    balanceId: uuid('balance_id').notNull(),
    movementType: varchar('movement_type', { length: 30 }).notNull(),
    amountMinutes: integer('amount_minutes').notNull(),
    sourceType: varchar('source_type', { length: 40 }).notNull().default('manual'),
    sourceId: uuid('source_id'),
    effectiveDate: date('effective_date').notNull().defaultNow(),
    description: text('description'),
    createdBy: uuid('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    balanceIdx: index('time_balance_movements_balance_idx').on(t.balanceId, t.createdAt),
    sourceIdx: index('time_balance_movements_source_idx').on(t.sourceType, t.sourceId),
  })
)

export type TimeBalance = typeof timeBalances.$inferSelect
export type NewTimeBalance = typeof timeBalances.$inferInsert
export type TimeBalanceMovement = typeof timeBalanceMovements.$inferSelect
export type NewTimeBalanceMovement = typeof timeBalanceMovements.$inferInsert

export type TimeBalanceType = 'compensatory' | 'disability' | 'family_disability'
export type TimeMovementType = 'initialization' | 'credit' | 'debit' | 'adjustment'
export type TimeMovementSource =
  | 'manual'
  | 'system_initialization'
  | 'annual_renewal'
  | 'overtime_incidence'
  | 'absence_incidence'
  | 'tardiness_incidence'
  | 'permission_incidence'
