import {
  createCuentaContable,
  deactivateCuentaContable,
  getCuentaContableByCode,
  getCuentaContableById,
  listCuentasContables,
  updateCuentaContable,
} from '@payroll/db'

// biome-ignore lint/suspicious/noExplicitAny: intentional generic DB type
type AnyDb = any

export type CuentaContableInput = {
  code: string
  name: string
}

export function listCuentasContablesService(db: AnyDb, search?: string) {
  return listCuentasContables(db, search)
}

export function getCuentaContableService(db: AnyDb, id: string) {
  return getCuentaContableById(db, id)
}

export async function createCuentaContableService(db: AnyDb, input: CuentaContableInput) {
  const existing = await getCuentaContableByCode(db, input.code)
  if (existing) {
    return {
      success: false as const,
      error: 'code_taken',
      message: `El código "${input.code}" ya está en uso`,
    }
  }
  const row = await createCuentaContable(db, {
    code: input.code.trim().toUpperCase(),
    name: input.name.trim(),
  })
  return { success: true as const, data: row }
}

export async function updateCuentaContableService(db: AnyDb, id: string, input: Partial<CuentaContableInput>) {
  const existing = await getCuentaContableById(db, id)
  if (!existing) {
    return { success: false as const, error: 'not_found', message: 'Cuenta contable no encontrada' }
  }
  if (input.code && input.code !== existing.code) {
    const taken = await getCuentaContableByCode(db, input.code)
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
  const row = await updateCuentaContable(db, id, patch)
  return { success: true as const, data: row }
}

export async function deactivateCuentaContableService(db: AnyDb, id: string) {
  const existing = await getCuentaContableById(db, id)
  if (!existing) {
    return { success: false as const, error: 'not_found', message: 'Cuenta contable no encontrada' }
  }
  const row = await deactivateCuentaContable(db, id)
  return { success: true as const, data: row }
}
