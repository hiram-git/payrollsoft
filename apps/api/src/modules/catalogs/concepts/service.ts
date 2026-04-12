import {
  activateConcept,
  createConcept,
  deactivateConcept,
  getConceptByCode,
  getConceptById,
  getConceptCatalogs,
  getConceptLinks,
  listConcepts,
  setConceptLinks,
  updateConcept,
} from '@payroll/db'
import type { ConceptLinks } from '@payroll/db'

// biome-ignore lint/suspicious/noExplicitAny: intentional generic DB type
type AnyDb = any

const VALID_TYPES = ['income', 'deduction', 'patronal']

export type ConceptInput = {
  code: string
  name: string
  type: string
  formula?: string | null
  isActive?: boolean
  // Behavior flags
  unit?: string
  printDetails?: boolean
  prorates?: boolean
  allowModify?: boolean
  isReferenceValue?: boolean
  useAmountCalc?: boolean
  allowZero?: boolean
  // Junction links
  links?: ConceptLinks
}

export function listConceptsService(db: AnyDb, search?: string) {
  return listConcepts(db, search)
}

export async function getConceptService(db: AnyDb, id: string) {
  const concept = await getConceptById(db, id)
  if (!concept) return null
  const links = await getConceptLinks(db, id)
  return { ...concept, links }
}

export async function getConceptConfigService(db: AnyDb) {
  return getConceptCatalogs(db)
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
  if (!VALID_TYPES.includes(input.type)) {
    return {
      success: false as const,
      error: 'invalid_type',
      message: `Type must be one of: ${VALID_TYPES.join(', ')}`,
    }
  }
  const row = await createConcept(db, {
    code: input.code.trim().toUpperCase(),
    name: input.name.trim(),
    type: input.type,
    formula: input.formula?.trim() || null,
    unit: input.unit ?? 'amount',
    printDetails: input.printDetails ?? false,
    prorates: input.prorates ?? false,
    allowModify: input.allowModify ?? false,
    isReferenceValue: input.isReferenceValue ?? false,
    useAmountCalc: input.useAmountCalc ?? false,
    allowZero: input.allowZero ?? false,
  })

  if (input.links) {
    await setConceptLinks(db, row.id, input.links)
  }

  const links = await getConceptLinks(db, row.id)
  return { success: true as const, data: { ...row, links } }
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
  if (input.type && !VALID_TYPES.includes(input.type)) {
    return {
      success: false as const,
      error: 'invalid_type',
      message: `Type must be one of: ${VALID_TYPES.join(', ')}`,
    }
  }

  const patch: Record<string, unknown> = {}
  if (input.code !== undefined) patch.code = input.code.trim().toUpperCase()
  if (input.name !== undefined) patch.name = input.name.trim()
  if (input.type !== undefined) patch.type = input.type
  if (input.formula !== undefined) patch.formula = input.formula?.trim() || null
  if (input.isActive !== undefined) patch.isActive = input.isActive
  if (input.unit !== undefined) patch.unit = input.unit
  if (input.printDetails !== undefined) patch.printDetails = input.printDetails
  if (input.prorates !== undefined) patch.prorates = input.prorates
  if (input.allowModify !== undefined) patch.allowModify = input.allowModify
  if (input.isReferenceValue !== undefined) patch.isReferenceValue = input.isReferenceValue
  if (input.useAmountCalc !== undefined) patch.useAmountCalc = input.useAmountCalc
  if (input.allowZero !== undefined) patch.allowZero = input.allowZero

  const row = await updateConcept(db, id, patch)

  if (input.links !== undefined) {
    await setConceptLinks(db, id, input.links)
  }

  const links = await getConceptLinks(db, id)
  return { success: true as const, data: { ...row, links } }
}

export async function deactivateConceptService(db: AnyDb, id: string) {
  const existing = await getConceptById(db, id)
  if (!existing) {
    return { success: false as const, error: 'not_found', message: 'Concept not found' }
  }
  const row = await deactivateConcept(db, id)
  return { success: true as const, data: row }
}

export async function activateConceptService(db: AnyDb, id: string) {
  const existing = await getConceptById(db, id)
  if (!existing) {
    return { success: false as const, error: 'not_found', message: 'Concept not found' }
  }
  const row = await activateConcept(db, id)
  return { success: true as const, data: row }
}
