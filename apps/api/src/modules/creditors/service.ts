import {
  createCreditor,
  createConcept,
  getConceptByCode,
  getCreditorByCode,
  getCreditorById,
  listCreditors,
  updateCreditor,
  updateConcept,
} from '@payroll/db'

// biome-ignore lint/suspicious/noExplicitAny: intentional generic DB type
type AnyDb = any

export type CreateCreditorInput = {
  code: string
  name: string
  description?: string | null
}

export type UpdateCreditorInput = {
  name?: string
  description?: string | null
  isActive?: boolean
}

export function listCreditorsService(db: AnyDb, includeInactive = false) {
  return listCreditors(db, includeInactive)
}

export async function getCreditorService(db: AnyDb, id: string) {
  return getCreditorById(db, id)
}

/**
 * Create a creditor and auto-generate its associated deduction concept.
 * The concept formula is: CUOTA_ACREEDOR("CODE")
 * The concept code is: ACR_{creditor.code}
 */
export async function createCreditorService(db: AnyDb, input: CreateCreditorInput) {
  const code = input.code.toUpperCase().trim()

  const existing = await getCreditorByCode(db, code)
  if (existing) {
    return { success: false as const, error: 'duplicate_code', message: `El código ${code} ya está en uso` }
  }

  const conceptCode = `ACR_${code}`

  // Auto-create the deduction concept first so we can link by ID
  let conceptId: string | null = null
  try {
    const concept = await createConcept(db, {
      code: conceptCode,
      name: input.name.trim(),
      type: 'deduction',
      formula: `CUOTA_ACREEDOR("${code}")`,
      isActive: true,
      unit: 'amount',
      printDetails: true,
      prorates: false,
      allowModify: false,
      isReferenceValue: false,
      useAmountCalc: false,
      allowZero: true,
    })
    conceptId = concept?.id ?? null
  } catch {
    // Concept creation failed (e.g. duplicate concept code) — try to find existing
    const existing = await getConceptByCode(db, conceptCode).catch(() => null)
    conceptId = existing?.id ?? null
  }

  const creditor = await createCreditor(db, {
    code,
    name: input.name.trim(),
    description: input.description ?? null,
    conceptId,
    isActive: true,
  })

  return { success: true as const, data: creditor }
}

export async function updateCreditorService(
  db: AnyDb,
  id: string,
  input: UpdateCreditorInput
) {
  const existing = await getCreditorById(db, id)
  if (!existing) {
    return { success: false as const, error: 'not_found', message: 'Acreedor no encontrado' }
  }

  const creditor = await updateCreditor(db, id, {
    name: input.name?.trim() ?? existing.name,
    description: input.description !== undefined ? input.description : existing.description,
    isActive: input.isActive !== undefined ? input.isActive : existing.isActive,
  })

  // Keep the auto-generated concept name in sync
  if (input.name && existing.conceptId) {
    await updateConcept(db, existing.conceptId, { name: input.name.trim() }).catch(() => {})
  }

  return { success: true as const, data: creditor }
}
