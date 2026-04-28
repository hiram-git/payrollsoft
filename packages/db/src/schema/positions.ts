import { boolean, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'

export const positions = pgTable('positions', {
  id: uuid('id').defaultRandom().primaryKey(),
  code: varchar('code', { length: 20 }).notNull().unique(),
  name: varchar('name', { length: 255 }).notNull(),
  salary: varchar('salary', { length: 20 }).notNull().default('0'),
  cargoId: uuid('cargo_id'),
  departamentoId: uuid('departamento_id'),
  funcionId: uuid('funcion_id'),
  partidaId: uuid('partida_id'),
  isActive: boolean('is_active').notNull().default(true),
  // Position lifecycle: 'vacante' (open / no employee assigned) |
  // 'en_uso' (currently occupied). Independent of `isActive`, which
  // controls whether the position is selectable at all.
  status: varchar('status', { length: 20 }).notNull().default('vacante'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export type Position = typeof positions.$inferSelect
export type NewPosition = typeof positions.$inferInsert
