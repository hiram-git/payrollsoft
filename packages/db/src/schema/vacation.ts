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
 * Saldo de vacaciones por empleado. Dos pools independientes:
 *
 *   • `enjoy`  — días de disfrute (tiempo libre con goce de sueldo).
 *   • `paid`   — días que se pagan sin tomar tiempo libre.
 *
 * Cada año cumplido (medido desde `hire_date`) suma +30 a cada pool.
 * El campo `last_accrual_date` guarda el último aniversario procesado
 * para que `recomputeAccrual()` sea idempotente.
 *
 * Disponibilidad por pool = `earned - used - reserved`. `reserved`
 * cubre solicitudes en estado `pending` para evitar doble-uso del
 * mismo saldo.
 */
export const vacationBalances = pgTable('vacation_balances', {
  id: uuid('id').defaultRandom().primaryKey(),
  employeeId: uuid('employee_id').notNull().unique(),
  enjoyEarned: integer('enjoy_earned').notNull().default(0),
  enjoyUsed: integer('enjoy_used').notNull().default(0),
  enjoyReserved: integer('enjoy_reserved').notNull().default(0),
  paidEarned: integer('paid_earned').notNull().default(0),
  paidUsed: integer('paid_used').notNull().default(0),
  paidReserved: integer('paid_reserved').notNull().default(0),
  lastAccrualDate: date('last_accrual_date'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

/**
 * Solicitud de vacaciones. El ciclo de vida es:
 *
 *   pending ──approve──▶ approved ──process──▶ processed
 *        │
 *        ├──reject──▶ rejected
 *        └──cancel──▶ cancelled
 *
 * `request_number` es un correlativo legible (VAC-YYYY-NNNN). Si la
 * solicitud incluye `paid_days > 0`, al procesarla se genera una
 * planilla tipo='vacaciones' y su id queda en `payroll_id`.
 */
export const vacationRequests = pgTable(
  'vacation_requests',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    requestNumber: varchar('request_number', { length: 20 }).notNull().unique(),
    employeeId: uuid('employee_id').notNull(),
    /** 'enjoy' | 'pay' | 'mixed' */
    requestType: varchar('request_type', { length: 20 }).notNull(),
    startDate: date('start_date'),
    endDate: date('end_date'),
    enjoyDays: integer('enjoy_days').notNull().default(0),
    paidDays: integer('paid_days').notNull().default(0),
    reason: text('reason'),
    /** 'pending' | 'approved' | 'rejected' | 'processed' | 'cancelled' */
    status: varchar('status', { length: 20 }).notNull().default('pending'),
    requestedBy: uuid('requested_by'),
    approvedBy: uuid('approved_by'),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    rejectionReason: text('rejection_reason'),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    payrollId: uuid('payroll_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    employeeIdx: index('vacation_requests_employee_idx').on(t.employeeId),
    statusIdx: index('vacation_requests_status_idx').on(t.status),
    createdIdx: index('vacation_requests_created_idx').on(t.createdAt),
  })
)

/**
 * Ledger append-only de movimientos de saldo. Cada cambio en
 * `vacation_balances` deja una fila aquí con el motivo
 * (accrual/reservation/release/commit/adjustment), el pool afectado
 * y los días (positivo = entrada al pool, negativo = consumo).
 */
export const vacationBalanceMovements = pgTable(
  'vacation_balance_movements',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    employeeId: uuid('employee_id').notNull(),
    requestId: uuid('request_id'),
    /** 'accrual' | 'reservation' | 'release' | 'commit' | 'adjustment' */
    movementType: varchar('movement_type', { length: 20 }).notNull(),
    /** 'enjoy' | 'paid' */
    pool: varchar('pool', { length: 10 }).notNull(),
    days: integer('days').notNull(),
    notes: text('notes'),
    performedBy: uuid('performed_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    employeeIdx: index('vacation_movements_employee_idx').on(t.employeeId, t.createdAt),
    requestIdx: index('vacation_movements_request_idx').on(t.requestId),
  })
)

/**
 * Reglas opt-in que mapean (request_type, departamento) → rol aprobador.
 * Misma forma que `employee_file_approval_rules`: `request_type IS NULL`
 * o `department_id IS NULL` significan "cualquier valor en ese eje".
 * Si no hay regla activa que matchee, el fallback en service es
 * `tenant_admin` (aprobador universal).
 */
export const vacationApprovalRules = pgTable(
  'vacation_approval_rules',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    requestType: varchar('request_type', { length: 20 }),
    departmentId: uuid('department_id'),
    approverRole: varchar('approver_role', { length: 50 }).notNull(),
    isActive: integer('is_active').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    unique: uniqueIndex('vacation_rules_unique').on(t.requestType, t.departmentId, t.approverRole),
  })
)

export type VacationBalance = typeof vacationBalances.$inferSelect
export type NewVacationBalance = typeof vacationBalances.$inferInsert
export type VacationRequest = typeof vacationRequests.$inferSelect
export type NewVacationRequest = typeof vacationRequests.$inferInsert
export type VacationBalanceMovement = typeof vacationBalanceMovements.$inferSelect
export type VacationApprovalRule = typeof vacationApprovalRules.$inferSelect

export type VacationRequestType = 'enjoy' | 'pay' | 'mixed'
export type VacationRequestStatus = 'pending' | 'approved' | 'rejected' | 'processed' | 'cancelled'
export type VacationMovementType = 'accrual' | 'reservation' | 'release' | 'commit' | 'adjustment'
export type VacationPool = 'enjoy' | 'paid'
