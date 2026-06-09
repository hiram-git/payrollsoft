import {
  buildDepartamentoTree,
  createDepartamento,
  deactivateDepartamento,
  getActiveChildCount,
  getDepartamentoByCode,
  getDepartamentoById,
  getDescendantIds,
  listDepartamentos,
  updateDepartamento,
} from '@payroll/db'
import { sql } from 'drizzle-orm'

// biome-ignore lint/suspicious/noExplicitAny: intentional generic DB type
type AnyDb = any

export type DepartamentoInput = {
  code: string
  name: string
  parentId?: string | null
}

export function listDepartamentosService(db: AnyDb, search?: string) {
  return listDepartamentos(db, search)
}

export async function getDepartamentoTreeService(db: AnyDb) {
  const all = await listDepartamentos(db)
  return buildDepartamentoTree(all)
}

export function getDepartamentoService(db: AnyDb, id: string) {
  return getDepartamentoById(db, id)
}

export async function createDepartamentoService(db: AnyDb, input: DepartamentoInput) {
  const existing = await getDepartamentoByCode(db, input.code)
  if (existing) {
    return {
      success: false as const,
      error: 'code_taken',
      message: `Code "${input.code}" is already in use`,
    }
  }
  if (input.parentId) {
    const parent = await getDepartamentoById(db, input.parentId)
    if (!parent) {
      return {
        success: false as const,
        error: 'parent_not_found',
        message: 'Parent department not found',
      }
    }
  }
  const row = await createDepartamento(db, {
    code: input.code.trim().toUpperCase(),
    name: input.name.trim(),
    parentId: input.parentId || null,
  })
  return { success: true as const, data: row }
}

export async function updateDepartamentoService(
  db: AnyDb,
  id: string,
  input: Partial<DepartamentoInput>
) {
  const existing = await getDepartamentoById(db, id)
  if (!existing) {
    return { success: false as const, error: 'not_found', message: 'Departamento not found' }
  }
  if (input.code && input.code !== existing.code) {
    const taken = await getDepartamentoByCode(db, input.code)
    if (taken) {
      return {
        success: false as const,
        error: 'code_taken',
        message: `Code "${input.code}" is already in use`,
      }
    }
  }
  // Cycle prevention: parentId cannot be self or a descendant
  if (input.parentId !== undefined && input.parentId !== null) {
    const all = await listDepartamentos(db)
    const descendants = getDescendantIds(all, id)
    if (descendants.has(input.parentId)) {
      return {
        success: false as const,
        error: 'cycle',
        message: 'Parent cannot be a descendant of this department',
      }
    }
  }
  const patch: Record<string, unknown> = {}
  if (input.code !== undefined) patch.code = input.code.trim().toUpperCase()
  if (input.name !== undefined) patch.name = input.name.trim()
  if ('parentId' in input) patch.parentId = input.parentId || null
  const row = await updateDepartamento(db, id, patch)
  return { success: true as const, data: row }
}

export async function deactivateDepartamentoService(db: AnyDb, id: string) {
  const existing = await getDepartamentoById(db, id)
  if (!existing) {
    return { success: false as const, error: 'not_found', message: 'Departamento not found' }
  }
  const childCount = await getActiveChildCount(db, id)
  if (childCount > 0) {
    return {
      success: false as const,
      error: 'has_children',
      message: `No se puede dar de baja: tiene ${childCount} sub-departamento(s) activo(s).`,
    }
  }
  const [emp] = (await db.execute(
    sql`SELECT COUNT(*)::int AS n FROM employees WHERE department_id = ${id}`
  )) as { n: number }[]
  const [pos] = (await db.execute(
    sql`SELECT COUNT(*)::int AS n FROM positions WHERE department_id = ${id}`
  )) as { n: number }[]
  if ((emp?.n ?? 0) > 0 || (pos?.n ?? 0) > 0) {
    const parts: string[] = []
    if ((emp?.n ?? 0) > 0) parts.push(`${emp.n} empleado(s)`)
    if ((pos?.n ?? 0) > 0) parts.push(`${pos.n} posición(es)`)
    return {
      success: false as const,
      error: 'in_use',
      message: `No se puede dar de baja: está siendo utilizado por ${parts.join(' y ')}.`,
    }
  }
  const row = await deactivateDepartamento(db, id)
  return { success: true as const, data: row }
}
