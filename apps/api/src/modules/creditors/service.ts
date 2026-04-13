import {
  createConcept,
  createCreditor,
  getConceptByCode,
  getCreditorByCode,
  getCreditorById,
  listCreditors,
  updateCreditor,
} from '@payroll/db'

// biome-ignore lint/suspicious/noExplicitAny: intentional generic DB type
type AnyDb = any

export type CreditorInput = {
  code: string
  name: string
}

export function listCreditorsService(db: AnyDb) {
  return listCreditors(db)
}

export function getCreditorService(db: AnyDb, id: string) {
  return getCreditorById(db, id)
}

export async function createCreditorService(db: AnyDb, input: CreditorInput) {
  const code = input.code.trim().toUpperCase()

  const existing = await getCreditorByCode(db, code)
  if (existing) {
    return {
      success: false as const,
      error: 'code_taken',
      message: `El código "${code}" ya está en uso`,
    }
  }

  const conceptCode = await getConceptByCode(db, code)
  if (conceptCode) {
    return {
      success: false as const,
      error: 'concept_code_taken',
      message: `Ya existe un concepto con el código "${code}"`,
    }
  }

  // Auto-create the deduction concept for this creditor
  const concept = await createConcept(db, {
    code,
    name: input.name.trim(),
    type: 'deduction',
    formula: null,
    unit: 'amount',
    printDetails: false,
    prorates: false,
    allowModify: false,
    isReferenceValue: false,
    useAmountCalc: false,
    allowZero: false,
  })

  const creditor = await createCreditor(db, {
    code,
    name: input.name.trim(),
    conceptId: concept.id,
    isActive: true,
  })

  return {
    success: true as const,
    data: { ...creditor, conceptCode: concept.code, conceptName: concept.name },
  }
}

export async function updateCreditorService(db: AnyDb, id: string, input: Partial<CreditorInput>) {
  const existing = await getCreditorById(db, id)
  if (!existing) {
    return { success: false as const, error: 'not_found', message: 'Acreedor no encontrado' }
  }

  const patch: Record<string, unknown> = {}
  if (input.name !== undefined) patch.name = input.name.trim()

  const row = await updateCreditor(db, id, patch)
  return { success: true as const, data: row }
}

export async function deactivateCreditorService(db: AnyDb, id: string) {
  const existing = await getCreditorById(db, id)
  if (!existing) {
    return { success: false as const, error: 'not_found', message: 'Acreedor no encontrado' }
  }
  const row = await updateCreditor(db, id, { isActive: false })
  return { success: true as const, data: row }
}

export async function activateCreditorService(db: AnyDb, id: string) {
  const existing = await getCreditorById(db, id)
  if (!existing) {
    return { success: false as const, error: 'not_found', message: 'Acreedor no encontrado' }
  }
  const row = await updateCreditor(db, id, { isActive: true })
  return { success: true as const, data: row }
}
