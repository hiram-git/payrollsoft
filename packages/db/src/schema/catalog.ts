import { boolean, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'

// ── Job Titles (previously "cargos") ─────────────────────────────────────────

export const jobTitles = pgTable('job_titles', {
  id: uuid('id').defaultRandom().primaryKey(),
  code: varchar('code', { length: 20 }).notNull().unique(),
  name: varchar('name', { length: 255 }).notNull(),
  description: varchar('description', { length: 500 }),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export type JobTitle = typeof jobTitles.$inferSelect
export type NewJobTitle = typeof jobTitles.$inferInsert

/** @deprecated Use `jobTitles` — kept for backward compatibility during migration */
export const cargos = jobTitles
/** @deprecated Use `JobTitle` */
export type Cargo = JobTitle

// ── Job Functions (previously "funciones") ───────────────────────────────────

export const jobFunctions = pgTable('job_functions', {
  id: uuid('id').defaultRandom().primaryKey(),
  code: varchar('code', { length: 20 }).notNull().unique(),
  name: varchar('name', { length: 255 }).notNull(),
  description: varchar('description', { length: 500 }),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export type JobFunction = typeof jobFunctions.$inferSelect
export type NewJobFunction = typeof jobFunctions.$inferInsert

/** @deprecated Use `jobFunctions` */
export const funciones = jobFunctions
/** @deprecated Use `JobFunction` */
export type Funcion = JobFunction

// ── Departments (previously "departamentos") ─────────────────────────────────

export const departments = pgTable('departments', {
  id: uuid('id').defaultRandom().primaryKey(),
  code: varchar('code', { length: 20 }).notNull().unique(),
  name: varchar('name', { length: 255 }).notNull(),
  parentId: uuid('parent_id'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export type Department = typeof departments.$inferSelect
export type NewDepartment = typeof departments.$inferInsert

/** @deprecated Use `departments` */
export const departamentos = departments
/** @deprecated Use `Department` */
export type Departamento = Department

// ── Budget Items (previously "partidas_presupuestarias") ─────────────────────

export const budgetItems = pgTable('budget_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  code: varchar('code', { length: 20 }).notNull().unique(),
  name: varchar('name', { length: 255 }).notNull(),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export type BudgetItem = typeof budgetItems.$inferSelect
export type NewBudgetItem = typeof budgetItems.$inferInsert

/** @deprecated Use `budgetItems` */
export const partidasPresupuestarias = budgetItems

// ── Chart of Accounts (previously "cuentas_contables") ───────────────────────

export const chartOfAccounts = pgTable('chart_of_accounts', {
  id: uuid('id').defaultRandom().primaryKey(),
  code: varchar('code', { length: 20 }).notNull().unique(),
  name: varchar('name', { length: 255 }).notNull(),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export type ChartOfAccount = typeof chartOfAccounts.$inferSelect
export type NewChartOfAccount = typeof chartOfAccounts.$inferInsert

/** @deprecated Use `chartOfAccounts` */
export const cuentasContables = chartOfAccounts

// ── Department tree helpers ──────────────────────────────────────────────────

export type DepartmentNode = Department & { children: DepartmentNode[] }

/** @deprecated Use `DepartmentNode` */
export type DepartamentoNode = DepartmentNode

export function buildDepartmentTree(flat: Department[]): DepartmentNode[] {
  const map = new Map<string, DepartmentNode>()
  for (const d of flat) {
    map.set(d.id, { ...d, children: [] })
  }
  const roots: DepartmentNode[] = []
  for (const node of map.values()) {
    if (node.parentId && map.has(node.parentId)) {
      map.get(node.parentId)?.children.push(node)
    } else {
      roots.push(node)
    }
  }
  return roots
}

/** @deprecated Use `buildDepartmentTree` */
export const buildDepartamentoTree = buildDepartmentTree

export function getDescendantIds(flat: Department[], rootId: string): Set<string> {
  const ids = new Set<string>([rootId])
  let changed = true
  while (changed) {
    changed = false
    for (const d of flat) {
      if (d.parentId && ids.has(d.parentId) && !ids.has(d.id)) {
        ids.add(d.id)
        changed = true
      }
    }
  }
  return ids
}
