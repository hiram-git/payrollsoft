import {
  createFuncion,
  deactivateFuncion,
  getFuncionByCode,
  getFuncionById,
  listFunciones,
  updateFuncion,
} from '@payroll/db'

// biome-ignore lint/suspicious/noExplicitAny: intentional generic DB type
type AnyDb = any

export type FuncionInput = {
  code: string
  name: string
  description?: string | null
}

export function listFuncionesService(db: AnyDb, search?: string) {
  return listFunciones(db, search)
}

export function getFuncionService(db: AnyDb, id: string) {
  return getFuncionById(db, id)
}

export async function createFuncionService(db: AnyDb, input: FuncionInput) {
  const existing = await getFuncionByCode(db, input.code)
  if (existing) {
    return {
      success: false as const,
      error: 'code_taken',
      message: `Code "${input.code}" is already in use`,
    }
  }
  const row = await createFuncion(db, {
    code: input.code.trim().toUpperCase(),
    name: input.name.trim(),
    description: input.description?.trim() || null,
  })
  return { success: true as const, data: row }
}

export async function updateFuncionService(db: AnyDb, id: string, input: Partial<FuncionInput>) {
  const existing = await getFuncionById(db, id)
  if (!existing) {
    return { success: false as const, error: 'not_found', message: 'Función not found' }
  }
  if (input.code && input.code !== existing.code) {
    const taken = await getFuncionByCode(db, input.code)
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
  const row = await updateFuncion(db, id, patch)
  return { success: true as const, data: row }
}

export async function deactivateFuncionService(db: AnyDb, id: string) {
  const existing = await getFuncionById(db, id)
  if (!existing) {
    return { success: false as const, error: 'not_found', message: 'Función not found' }
  }
  const row = await deactivateFuncion(db, id)
  return { success: true as const, data: row }
}
