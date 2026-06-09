import {
  createPartida,
  deactivatePartida,
  getPartidaByCode,
  getPartidaById,
  listPartidas,
  updatePartida,
} from '@payroll/db'
import { sql } from 'drizzle-orm'

// biome-ignore lint/suspicious/noExplicitAny: intentional generic DB type
type AnyDb = any

async function countBudgetItemRefs(db: AnyDb, id: string): Promise<{ positions: number }> {
  // Positions reference budget items via 4 columns: budget_item_id, overtime_*,
  // representation_*, thirteenth_month_*.
  const [pos] = (await db.execute(
    sql`SELECT COUNT(*)::int AS n FROM positions
        WHERE budget_item_id = ${id}
           OR overtime_budget_item_id = ${id}
           OR representation_budget_item_id = ${id}
           OR thirteenth_month_budget_item_id = ${id}`
  )) as { n: number }[]
  return { positions: pos?.n ?? 0 }
}

export type PartidaInput = {
  code: string
  name: string
}

export function listPartidasService(db: AnyDb, search?: string) {
  return listPartidas(db, search)
}

export function getPartidaService(db: AnyDb, id: string) {
  return getPartidaById(db, id)
}

export async function createPartidaService(db: AnyDb, input: PartidaInput) {
  const existing = await getPartidaByCode(db, input.code)
  if (existing) {
    return {
      success: false as const,
      error: 'code_taken',
      message: `El código "${input.code}" ya está en uso`,
    }
  }
  const row = await createPartida(db, {
    code: input.code.trim().toUpperCase(),
    name: input.name.trim(),
  })
  return { success: true as const, data: row }
}

export async function updatePartidaService(db: AnyDb, id: string, input: Partial<PartidaInput>) {
  const existing = await getPartidaById(db, id)
  if (!existing) {
    return { success: false as const, error: 'not_found', message: 'Partida no encontrada' }
  }
  if (input.code && input.code !== existing.code) {
    const taken = await getPartidaByCode(db, input.code)
    if (taken) {
      return {
        success: false as const,
        error: 'code_taken',
        message: `El código "${input.code}" ya está en uso`,
      }
    }
  }
  const patch: Record<string, unknown> = {}
  if (input.code !== undefined) patch.code = input.code.trim().toUpperCase()
  if (input.name !== undefined) patch.name = input.name.trim()
  const row = await updatePartida(db, id, patch)
  return { success: true as const, data: row }
}

export async function deactivatePartidaService(db: AnyDb, id: string) {
  const existing = await getPartidaById(db, id)
  if (!existing) {
    return { success: false as const, error: 'not_found', message: 'Partida no encontrada' }
  }
  const refs = await countBudgetItemRefs(db, id)
  if (refs.positions > 0) {
    return {
      success: false as const,
      error: 'in_use',
      message: `No se puede dar de baja: está siendo utilizada por ${refs.positions} posición(es).`,
    }
  }
  const row = await deactivatePartida(db, id)
  return { success: true as const, data: row }
}
