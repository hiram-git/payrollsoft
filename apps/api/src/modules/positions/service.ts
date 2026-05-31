import {
  createPosition,
  deactivatePosition,
  getCargoById,
  getDepartamentoById,
  getFuncionById,
  getPosition,
  getPositionByCode,
  listBudgetItems,
  listPositions,
  updatePosition,
} from '@payroll/db'

// biome-ignore lint/suspicious/noExplicitAny: intentional generic DB type
type AnyDb = any

export async function listPositionsService(db: AnyDb, onlyActive?: boolean) {
  const data = await listPositions(db, onlyActive)
  return { success: true, data }
}

export async function getPositionService(db: AnyDb, id: string) {
  const data = await getPosition(db, id)
  return data
}

export type PositionInput = {
  code: string
  name: string
  salary: string
  overtimeAmount?: string
  representationAmount?: string
  jobTitleId?: string | null
  departmentId?: string | null
  budgetItemId?: string | null
  overtimeBudgetItemId?: string | null
  representationBudgetItemId?: string | null
  thirteenthMonthBudgetItemId?: string | null
  status?: 'en_uso' | 'vacante'
}

const VALID_STATUS = new Set(['en_uso', 'vacante'])

/**
 * Every budget item (partida) referenced by a position must exist and be
 * active. Returns an error result when any referenced id is unknown or
 * inactive, otherwise null.
 */
async function validateBudgetItems(
  db: AnyDb,
  input: Partial<PositionInput>
): Promise<{ error: 'invalid_budget_item'; message: string } | null> {
  const referenced = [
    input.budgetItemId,
    input.overtimeBudgetItemId,
    input.representationBudgetItemId,
    input.thirteenthMonthBudgetItemId,
  ].filter((id): id is string => Boolean(id))
  if (referenced.length === 0) return null
  const active = await listBudgetItems(db, true)
  const activeIds = new Set(active.map((b: { id: string }) => b.id))
  for (const id of referenced) {
    if (!activeIds.has(id)) {
      return {
        error: 'invalid_budget_item',
        message: 'Una de las partidas presupuestarias seleccionadas no existe o está inactiva',
      }
    }
  }
  return null
}

/**
 * Returns whether `code` is free for use. Used by the create/edit forms
 * for realtime onBlur feedback. When `excludeId` is provided, a hit on
 * that exact id counts as available — so editing a position keeps its
 * own code without showing a phantom collision.
 */
export async function checkPositionCodeService(db: AnyDb, code: string, excludeId?: string) {
  const trimmed = code.trim()
  if (!trimmed) return { available: false, reason: 'empty' as const }
  const existing = await getPositionByCode(db, trimmed)
  if (!existing) return { available: true, current: null }
  if (excludeId && existing.id === excludeId) return { available: true, current: existing.id }
  return { available: false, reason: 'taken' as const, current: existing.id }
}

function normalisePositionInput<T extends Partial<PositionInput>>(input: T): T {
  if (input.status && !VALID_STATUS.has(input.status)) {
    // Defensive fallback — the route validator already restricts this,
    // but a stray value is treated as "vacante" instead of crashing.
    return { ...input, status: 'vacante' as const }
  }
  return input
}

export async function createPositionService(db: AnyDb, input: PositionInput) {
  const budgetError = await validateBudgetItems(db, input)
  if (budgetError) return { success: false, ...budgetError }
  try {
    const data = await createPosition(db, normalisePositionInput(input))
    return { success: true, data }
  } catch (err) {
    const msg = err instanceof Error ? err.message : ''
    if (msg.includes('positions_code_unique') || msg.includes('unique')) {
      return { success: false, error: 'code_taken', message: 'Código ya existe' }
    }
    throw err
  }
}

export async function updatePositionService(db: AnyDb, id: string, input: Partial<PositionInput>) {
  const existing = await getPosition(db, id)
  if (!existing) return { success: false, error: 'not_found', message: 'Posición no encontrada' }
  const budgetError = await validateBudgetItems(db, input)
  if (budgetError) return { success: false, ...budgetError }
  try {
    const data = await updatePosition(db, id, normalisePositionInput(input))
    return { success: true, data }
  } catch (err) {
    const msg = err instanceof Error ? err.message : ''
    if (msg.includes('unique'))
      return { success: false, error: 'code_taken', message: 'Código ya existe' }
    throw err
  }
}

export async function deletePositionService(db: AnyDb, id: string) {
  const existing = await getPosition(db, id)
  if (!existing) return { success: false, error: 'not_found', message: 'Posición no encontrada' }
  const data = await deactivatePosition(db, id)
  return { success: true, data }
}
