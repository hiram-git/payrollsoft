import {
  createConcept,
  deactivateConcept,
  getConceptByCode,
  getConceptById,
  listConcepts,
  updateConcept,
} from '@payroll/db'

// biome-ignore lint/suspicious/noExplicitAny: intentional generic DB type
type AnyDb = any

export type ConceptInput = {
  code: string
  name: string
  type: string
  formula?: string | null
  isActive?: boolean
}

export function listConceptsService(db: AnyDb, search?: string) {
  return listConcepts(db, search)
}

export function getConceptService(db: AnyDb, id: string) {
  return getConceptById(db, id)
}

export async function createConceptService(db: AnyDb, input: ConceptInput) {
  const existing = await getConceptByCode(db, input.code)
  if (existing) {
    return {
      success: false as const,
      error: 'code_taken',
      message: `Code "${input.code}" is already in use`,
    }
  }
  if (!['income', 'deduction'].includes(input.type)) {
    return {
      success: false as const,
      error: 'invalid_type',
      message: 'Type must be income or deduction',
    }
  }
  const row = await createConcept(db, {
    code: input.code.trim().toUpperCase(),
    name: input.name.trim(),
    type: input.type,
    formula: input.formula?.trim() || null,
  })
  return { success: true as const, data: row }
}

export async function updateConceptService(db: AnyDb, id: string, input: Partial<ConceptInput>) {
  const existing = await getConceptById(db, id)
  if (!existing) {
    return { success: false as const, error: 'not_found', message: 'Concept not found' }
  }
  if (input.code && input.code !== existing.code) {
    const taken = await getConceptByCode(db, input.code)
    if (taken) {
      return {
        success: false as const,
        error: 'code_taken',
        message: `Code "${input.code}" is already in use`,
      }
    }
  }
  if (input.type && !['income', 'deduction'].includes(input.type)) {
    return {
      success: false as const,
      error: 'invalid_type',
      message: 'Type must be income or deduction',
    }
  }
  const patch: Record<string, unknown> = {}
  if (input.code !== undefined) patch.code = input.code.trim().toUpperCase()
  if (input.name !== undefined) patch.name = input.name.trim()
  if (input.type !== undefined) patch.type = input.type
  if (input.formula !== undefined) patch.formula = input.formula?.trim() || null
  if (input.isActive !== undefined) patch.isActive = input.isActive
  const row = await updateConcept(db, id, patch)
  return { success: true as const, data: row }
}

export async function deactivateConceptService(db: AnyDb, id: string) {
  const existing = await getConceptById(db, id)
  if (!existing) {
    return { success: false as const, error: 'not_found', message: 'Concept not found' }
  }
  const row = await deactivateConcept(db, id)
  return { success: true as const, data: row }
}
