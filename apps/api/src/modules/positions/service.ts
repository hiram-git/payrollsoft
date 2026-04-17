import {
  createPosition,
  deactivatePosition,
  getCargoById,
  getDepartamentoById,
  getFuncionById,
  getPosition,
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
  cargoId?: string | null
  departamentoId?: string | null
  funcionId?: string | null
}

export async function createPositionService(db: AnyDb, input: PositionInput) {
  try {
    const data = await createPosition(db, input)
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
  try {
    const data = await updatePosition(db, id, input)
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
