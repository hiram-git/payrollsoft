import {
  createCargo,
  deactivateCargo,
  getCargoByCode,
  getCargoById,
  listCargos,
  updateCargo,
} from '@payroll/db'
import { sql } from 'drizzle-orm'

// biome-ignore lint/suspicious/noExplicitAny: intentional generic DB type
type AnyDb = any

async function countJobTitleRefs(
  db: AnyDb,
  id: string
): Promise<{ employees: number; positions: number }> {
  const [emp] = (await db.execute(
    sql`SELECT COUNT(*)::int AS n FROM employees WHERE job_title_id = ${id}`
  )) as { n: number }[]
  const [pos] = (await db.execute(
    sql`SELECT COUNT(*)::int AS n FROM positions WHERE job_title_id = ${id}`
  )) as { n: number }[]
  return { employees: emp?.n ?? 0, positions: pos?.n ?? 0 }
}

export type CargoInput = {
  code: string
  name: string
  description?: string | null
}

export function listCargosService(db: AnyDb, search?: string) {
  return listCargos(db, search)
}

export function getCargoService(db: AnyDb, id: string) {
  return getCargoById(db, id)
}

export async function createCargoService(db: AnyDb, input: CargoInput) {
  const existing = await getCargoByCode(db, input.code)
  if (existing) {
    return {
      success: false as const,
      error: 'code_taken',
      message: `Code "${input.code}" is already in use`,
    }
  }
  const row = await createCargo(db, {
    code: input.code.trim().toUpperCase(),
    name: input.name.trim(),
    description: input.description?.trim() || null,
  })
  return { success: true as const, data: row }
}

export async function updateCargoService(db: AnyDb, id: string, input: Partial<CargoInput>) {
  const existing = await getCargoById(db, id)
  if (!existing) {
    return { success: false as const, error: 'not_found', message: 'Cargo not found' }
  }
  if (input.code && input.code !== existing.code) {
    const taken = await getCargoByCode(db, input.code)
    if (taken) {
      return {
        success: false as const,
        error: 'code_taken',
        message: `Code "${input.code}" is already in use`,
      }
    }
  }
  const patch: Record<string, unknown> = {}
  if (input.code !== undefined) patch.code = input.code.trim().toUpperCase()
  if (input.name !== undefined) patch.name = input.name.trim()
  if (input.description !== undefined) patch.description = input.description?.trim() || null
  const row = await updateCargo(db, id, patch)
  return { success: true as const, data: row }
}

export async function deactivateCargoService(db: AnyDb, id: string) {
  const existing = await getCargoById(db, id)
  if (!existing) {
    return { success: false as const, error: 'not_found', message: 'Cargo not found' }
  }
  const refs = await countJobTitleRefs(db, id)
  if (refs.employees > 0 || refs.positions > 0) {
    const parts: string[] = []
    if (refs.employees > 0) parts.push(`${refs.employees} empleado(s)`)
    if (refs.positions > 0) parts.push(`${refs.positions} posición(es)`)
    return {
      success: false as const,
      error: 'in_use',
      message: `No se puede dar de baja: está siendo utilizado por ${parts.join(' y ')}.`,
    }
  }
  const row = await deactivateCargo(db, id)
  return { success: true as const, data: row }
}
