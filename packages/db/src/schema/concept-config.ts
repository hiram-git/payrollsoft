import { integer, pgTable, primaryKey, uuid, varchar } from 'drizzle-orm/pg-core'

// ─── Catalog: Tipos de Planilla ───────────────────────────────────────────────

export const conceptPayrollTypes = pgTable('concept_payroll_types', {
  id: uuid('id').defaultRandom().primaryKey(),
  code: varchar('code', { length: 50 }).notNull().unique(),
  name: varchar('name', { length: 100 }).notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
})

// ─── Catalog: Frecuencias ─────────────────────────────────────────────────────

export const conceptFrequencies = pgTable('concept_frequencies', {
  id: uuid('id').defaultRandom().primaryKey(),
  code: varchar('code', { length: 50 }).notNull().unique(),
  name: varchar('name', { length: 100 }).notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
})

// ─── Catalog: Situaciones del Empleado ────────────────────────────────────────

export const conceptSituations = pgTable('concept_situations', {
  id: uuid('id').defaultRandom().primaryKey(),
  code: varchar('code', { length: 50 }).notNull().unique(),
  name: varchar('name', { length: 100 }).notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
})

// ─── Catalog: Acumulados ─────────────────────────────────────────────────────

export const conceptAccumulators = pgTable('concept_accumulators', {
  id: uuid('id').defaultRandom().primaryKey(),
  code: varchar('code', { length: 50 }).notNull().unique(),
  name: varchar('name', { length: 100 }).notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
})

// ─── Junction: Concepto ↔ Tipos de Planilla ───────────────────────────────────

export const conceptPayrollTypeLinks = pgTable(
  'concept_payroll_type_links',
  {
    conceptId: uuid('concept_id').notNull(),
    payrollTypeId: uuid('payroll_type_id').notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.conceptId, t.payrollTypeId] }) })
)

// ─── Junction: Concepto ↔ Frecuencias ────────────────────────────────────────

export const conceptFrequencyLinks = pgTable(
  'concept_frequency_links',
  {
    conceptId: uuid('concept_id').notNull(),
    frequencyId: uuid('frequency_id').notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.conceptId, t.frequencyId] }) })
)

// ─── Junction: Concepto ↔ Situaciones ────────────────────────────────────────

export const conceptSituationLinks = pgTable(
  'concept_situation_links',
  {
    conceptId: uuid('concept_id').notNull(),
    situationId: uuid('situation_id').notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.conceptId, t.situationId] }) })
)

// ─── Junction: Concepto ↔ Acumulados ─────────────────────────────────────────

export const conceptAccumulatorLinks = pgTable(
  'concept_accumulator_links',
  {
    conceptId: uuid('concept_id').notNull(),
    accumulatorId: uuid('accumulator_id').notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.conceptId, t.accumulatorId] }) })
)

export type ConceptPayrollType = typeof conceptPayrollTypes.$inferSelect
export type ConceptFrequency = typeof conceptFrequencies.$inferSelect
export type ConceptSituation = typeof conceptSituations.$inferSelect
export type ConceptAccumulator = typeof conceptAccumulators.$inferSelect
