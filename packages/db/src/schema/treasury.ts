import {
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
 * Catálogo de bancos del país. Seedeado con los bancos panameños más
 * usados (BNP, Banco General, Banistmo, etc.). `routing` es el número
 * de ruta que viaja en el TXT ACH; `swift` se reserva para futuras
 * integraciones internacionales.
 */
export const banks = pgTable('banks', {
  id: uuid('id').defaultRandom().primaryKey(),
  code: varchar('code', { length: 20 }).notNull().unique(),
  name: varchar('name', { length: 120 }).notNull(),
  routing: varchar('routing', { length: 15 }),
  swift: varchar('swift', { length: 15 }),
  country: varchar('country', { length: 2 }).notNull().default('PA'),
  isActive: integer('is_active').notNull().default(1),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

/**
 * Chequera asignada a la empresa. Cada chequera tiene un rango
 * [start_number, end_number] de cheques físicos y un puntero
 * `next_number` que avanza al emitir cheques. `purpose` permite tener
 * chequeras separadas (empleados / acreedores / general).
 */
export const treasuryCheckbooks = pgTable(
  'treasury_checkbooks',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    code: varchar('code', { length: 30 }).notNull().unique(),
    name: varchar('name', { length: 160 }).notNull(),
    bankId: uuid('bank_id'),
    accountNumber: varchar('account_number', { length: 40 }).notNull(),
    startNumber: integer('start_number').notNull(),
    endNumber: integer('end_number').notNull(),
    nextNumber: integer('next_number').notNull(),
    /** 'employees' | 'creditors' | 'general' */
    purpose: varchar('purpose', { length: 20 }).notNull().default('general'),
    isActive: integer('is_active').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    bankIdx: index('treasury_checkbooks_bank_idx').on(t.bankId),
  })
)

/**
 * Corrida de pago — agrupa todo lo que sale por una planilla
 * específica. Puede tener un mix de cheques + ACH + efectivo según
 * el `payment_method` de cada beneficiario. `status` viaja:
 *
 *   draft → open → closed
 *               └→ cancelled
 */
export const treasuryPaymentRuns = pgTable(
  'treasury_payment_runs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    payrollId: uuid('payroll_id'),
    name: varchar('name', { length: 255 }).notNull(),
    /** 'draft' | 'open' | 'closed' | 'cancelled' */
    status: varchar('status', { length: 20 }).notNull().default('draft'),
    totalAmount: varchar('total_amount', { length: 20 }).notNull().default('0'),
    achTotal: varchar('ach_total', { length: 20 }).notNull().default('0'),
    checkTotal: varchar('check_total', { length: 20 }).notNull().default('0'),
    cashTotal: varchar('cash_total', { length: 20 }).notNull().default('0'),
    notes: text('notes'),
    createdBy: uuid('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
  },
  (t) => ({
    payrollIdx: index('treasury_payment_runs_payroll_idx').on(t.payrollId),
  })
)

/**
 * Cheque emitido. El número correlativo viene de la chequera; el
 * monto se guarda como string (precision consistency con el resto
 * de la base) y se almacena también en letras (ej. "MIL DOSCIENTOS
 * BALBOAS CON 50/100") para imprimir directo del registro sin
 * recalcular.
 */
export const treasuryChecks = pgTable(
  'treasury_checks',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    checkbookId: uuid('checkbook_id').notNull(),
    checkNumber: integer('check_number').notNull(),
    paymentRunId: uuid('payment_run_id'),
    /** 'employee' | 'creditor' | 'other' */
    beneficiaryType: varchar('beneficiary_type', { length: 20 }).notNull(),
    /** UUID del employee o creditor según `beneficiaryType` */
    beneficiaryRefId: uuid('beneficiary_ref_id'),
    beneficiaryName: varchar('beneficiary_name', { length: 255 }).notNull(),
    amount: varchar('amount', { length: 20 }).notNull(),
    amountInWords: text('amount_in_words').notNull(),
    concept: text('concept'),
    issueDate: date('issue_date').notNull(),
    /** 'issued' | 'printed' | 'cleared' | 'voided' */
    status: varchar('status', { length: 20 }).notNull().default('issued'),
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    voidReason: text('void_reason'),
    printedAt: timestamp('printed_at', { withTimezone: true }),
    clearedAt: date('cleared_at'),
    createdBy: uuid('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Único por (chequera, número) excepto anulados — los anulados
    // mantienen el número en histórico pero liberan el siguiente.
    checkbookNumUnique: uniqueIndex('treasury_checks_checkbook_num_unique').on(
      t.checkbookId,
      t.checkNumber
    ),
    runIdx: index('treasury_checks_run_idx').on(t.paymentRunId),
    benefIdx: index('treasury_checks_beneficiary_idx').on(t.beneficiaryType, t.beneficiaryRefId),
  })
)

/**
 * Lote ACH — un archivo TXT generado para enviar al banco. Preserva
 * el contenido exacto (`file_content`) y el resumen para que la
 * descarga sea reproducible aunque cambien los datos subyacentes.
 */
export const treasuryAchBatches = pgTable(
  'treasury_ach_batches',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    paymentRunId: uuid('payment_run_id'),
    sourceBankId: uuid('source_bank_id'),
    /** Identificador del formato de archivo, p.ej. 'mupa_v1' */
    format: varchar('format', { length: 30 }).notNull().default('mupa_v1'),
    fileName: varchar('file_name', { length: 255 }).notNull(),
    totalAmount: varchar('total_amount', { length: 20 }).notNull().default('0'),
    recordCount: integer('record_count').notNull().default(0),
    fileContent: text('file_content').notNull(),
    generatedBy: uuid('generated_by'),
    generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    runIdx: index('treasury_ach_batches_run_idx').on(t.paymentRunId),
  })
)

/**
 * Detalle de cada línea ACH dentro de un batch. Snapshot del nombre,
 * cuenta y ruta al momento de generar — si después cambian los datos
 * del empleado, el batch sigue siendo reproducible byte por byte.
 */
export const treasuryAchLines = pgTable(
  'treasury_ach_lines',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    batchId: uuid('batch_id').notNull(),
    employeeId: uuid('employee_id'),
    beneficiaryName: varchar('beneficiary_name', { length: 255 }).notNull(),
    identification: varchar('identification', { length: 30 }),
    bankRouting: varchar('bank_routing', { length: 15 }),
    accountNumber: varchar('account_number', { length: 40 }).notNull(),
    /** 'savings' | 'checking' */
    accountType: varchar('account_type', { length: 20 }).notNull(),
    amount: varchar('amount', { length: 20 }).notNull(),
  },
  (t) => ({
    batchIdx: index('treasury_ach_lines_batch_idx').on(t.batchId),
    employeeIdx: index('treasury_ach_lines_employee_idx').on(t.employeeId),
  })
)

export type Bank = typeof banks.$inferSelect
export type NewBank = typeof banks.$inferInsert
export type TreasuryCheckbook = typeof treasuryCheckbooks.$inferSelect
export type NewTreasuryCheckbook = typeof treasuryCheckbooks.$inferInsert
export type TreasuryPaymentRun = typeof treasuryPaymentRuns.$inferSelect
export type NewTreasuryPaymentRun = typeof treasuryPaymentRuns.$inferInsert
export type TreasuryCheck = typeof treasuryChecks.$inferSelect
export type NewTreasuryCheck = typeof treasuryChecks.$inferInsert
export type TreasuryAchBatch = typeof treasuryAchBatches.$inferSelect
export type NewTreasuryAchBatch = typeof treasuryAchBatches.$inferInsert
export type TreasuryAchLine = typeof treasuryAchLines.$inferSelect

export type PaymentMethod = 'ach' | 'check' | 'cash'
export type AccountType = 'savings' | 'checking'
export type CheckStatus = 'issued' | 'printed' | 'cleared' | 'voided'
export type PaymentRunStatus = 'draft' | 'open' | 'closed' | 'cancelled'
export type CheckbookPurpose = 'employees' | 'creditors' | 'general'
