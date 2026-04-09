import { boolean, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'

// ── Cargos (Job Positions) ────────────────────────────────────────────────────

export const cargos = pgTable('cargos', {
  id: uuid('id').defaultRandom().primaryKey(),
  code: varchar('code', { length: 20 }).notNull().unique(),
  name: varchar('name', { length: 255 }).notNull(),
  description: varchar('description', { length: 500 }),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export type Cargo = typeof cargos.$inferSelect
export type NewCargo = typeof cargos.$inferInsert

// ── Funciones (Job Functions) ─────────────────────────────────────────────────

export const funciones = pgTable('funciones', {
  id: uuid('id').defaultRandom().primaryKey(),
  code: varchar('code', { length: 20 }).notNull().unique(),
  name: varchar('name', { length: 255 }).notNull(),
  description: varchar('description', { length: 500 }),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export type Funcion = typeof funciones.$inferSelect
export type NewFuncion = typeof funciones.$inferInsert

// ── Departamentos (Departments — adjacency list, no FK for multi-tenant) ──────

export const departamentos = pgTable('departamentos', {
  id: uuid('id').defaultRandom().primaryKey(),
  code: varchar('code', { length: 20 }).notNull().unique(),
  name: varchar('name', { length: 255 }).notNull(),
  parentId: uuid('parent_id'), // NO .references() — breaks multi-tenant search_path
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export type Departamento = typeof departamentos.$inferSelect
export type NewDepartamento = typeof departamentos.$inferInsert

// ── Department tree node (built in-memory) ────────────────────────────────────

export type DepartamentoNode = Departamento & { children: DepartamentoNode[] }

/**
 * Build a nested tree from a flat list of departamentos.
 * Roots are nodes where parentId is null.
 */
export function buildDepartamentoTree(flat: Departamento[]): DepartamentoNode[] {
  const map = new Map<string, DepartamentoNode>()

  for (const d of flat) {
    map.set(d.id, { ...d, children: [] })
  }

  const roots: DepartamentoNode[] = []

  for (const node of map.values()) {
    if (node.parentId && map.has(node.parentId)) {
      map.get(node.parentId)?.children.push(node)
    } else {
      roots.push(node)
    }
  }

  return roots
}

/**
 * Collect all descendant IDs (including the node itself) for cycle prevention.
 */
export function getDescendantIds(flat: Departamento[], rootId: string): Set<string> {
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
