import {
  createEmployee,
  deactivateEmployee,
  getCargoById,
  getDefaultPayrollType,
  getDepartamentoById,
  getEmployee,
  getEmployeeByCode,
  getFuncionById,
  listEmployees,
  setEmployeePayrollTypes,
  updateEmployee,
} from '@payroll/db'
import type { PaginationOptions } from '@payroll/db'

// biome-ignore lint/suspicious/noExplicitAny: intentional generic DB type
type AnyDb = any

export type EmployeeCreateInput = {
  code: string
  firstName: string
  lastName: string
  idNumber: string
  socialSecurityNumber?: string | null
  email?: string | null
  phone?: string | null
  cargoId?: string | null
  funcionId?: string | null
  departamentoId?: string | null
  positionId?: string | null
  hireDate: string
  baseSalary: string
  payFrequency?: 'biweekly' | 'monthly' | 'weekly'
  payrollTypeIds?: string[]
  customFields?: Record<string, unknown>
}

export type EmployeeUpdateInput = Partial<EmployeeCreateInput>

// ─── Catalog resolution ───────────────────────────────────────────────────────

/**
 * Resolves cargoId → position text, departamentoId → department text.
 * Returns only the fields that changed so callers can merge into patch.
 */
async function resolveCatalogNames(
  db: AnyDb,
  input: {
    cargoId?: string | null
    funcionId?: string | null
    departamentoId?: string | null
  }
): Promise<{ position: string | null; department: string | null }> {
  const [cargo, dept] = await Promise.all([
    input.cargoId ? getCargoById(db, input.cargoId) : null,
    input.departamentoId ? getDepartamentoById(db, input.departamentoId) : null,
  ])
  return {
    position: cargo?.name ?? null,
    department: dept?.name ?? null,
  }
}

// ─── List ─────────────────────────────────────────────────────────────────────

export function listEmployeesService(
  db: AnyDb,
  filter: {
    search?: string
    department?: string
    isActive?: boolean
    payFrequency?: string
    payrollTypeId?: string
  },
  pagination: PaginationOptions
) {
  return listEmployees(db, filter, pagination)
}

// ─── Get one ──────────────────────────────────────────────────────────────────

export function getEmployeeService(db: AnyDb, id: string) {
  return getEmployee(db, id)
}

// ─── Create ───────────────────────────────────────────────────────────────────

export async function createEmployeeService(db: AnyDb, input: EmployeeCreateInput) {
  const existingCode = await getEmployeeByCode(db, input.code)
  if (existingCode) {
    return {
      success: false as const,
      error: 'code_taken',
      message: `Code "${input.code}" is already in use`,
    }
  }

  const { position, department } = await resolveCatalogNames(db, input)

  const employee = await createEmployee(db, {
    code: input.code.trim().toUpperCase(),
    firstName: input.firstName.trim(),
    lastName: input.lastName.trim(),
    idNumber: input.idNumber.trim(),
    socialSecurityNumber: input.socialSecurityNumber?.trim() || null,
    email: input.email?.trim().toLowerCase() || null,
    phone: input.phone?.trim() || null,
    cargoId: input.cargoId || null,
    funcionId: input.funcionId || null,
    departamentoId: input.departamentoId || null,
    positionId: input.positionId || null,
    position,
    department,
    hireDate: input.hireDate,
    baseSalary: input.baseSalary,
    payFrequency: input.payFrequency ?? 'biweekly',
    customFields: input.customFields ?? {},
  })

  if (input.payrollTypeIds && input.payrollTypeIds.length > 0) {
    await setEmployeePayrollTypes(db, employee.id, input.payrollTypeIds)
  } else {
    // Auto-assign to the default (first by sortOrder) payroll type when none specified
    const defaultType = await getDefaultPayrollType(db).catch(() => null)
    if (defaultType) {
      await setEmployeePayrollTypes(db, employee.id, [defaultType.id])
    }
  }

  return { success: true as const, data: employee }
}

// ─── Update ───────────────────────────────────────────────────────────────────

export async function updateEmployeeService(db: AnyDb, id: string, input: EmployeeUpdateInput) {
  const existing = await getEmployee(db, id)
  if (!existing) {
    return { success: false as const, error: 'not_found', message: 'Employee not found' }
  }

  if (input.code && input.code !== existing.code) {
    const taken = await getEmployeeByCode(db, input.code)
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
  if (input.firstName !== undefined) patch.firstName = input.firstName.trim()
  if (input.lastName !== undefined) patch.lastName = input.lastName.trim()
  if (input.idNumber !== undefined) patch.idNumber = input.idNumber.trim()
  if (input.socialSecurityNumber !== undefined)
    patch.socialSecurityNumber = input.socialSecurityNumber?.trim() || null
  if (input.email !== undefined) patch.email = input.email?.trim().toLowerCase() || null
  if (input.phone !== undefined) patch.phone = input.phone?.trim() || null
  if (input.hireDate !== undefined) patch.hireDate = input.hireDate
  if (input.baseSalary !== undefined) patch.baseSalary = input.baseSalary
  if (input.payFrequency !== undefined) patch.payFrequency = input.payFrequency
  if (input.customFields !== undefined) patch.customFields = input.customFields
  if ('positionId' in input) patch.positionId = input.positionId || null

  // Catalog IDs — resolve names when any ID changes
  const catalogChanged =
    input.cargoId !== undefined ||
    input.funcionId !== undefined ||
    input.departamentoId !== undefined

  if (catalogChanged) {
    // Use incoming values if provided, otherwise fall back to existing
    const resolveInput = {
      cargoId: 'cargoId' in input ? input.cargoId : existing.cargoId,
      funcionId: 'funcionId' in input ? input.funcionId : existing.funcionId,
      departamentoId: 'departamentoId' in input ? input.departamentoId : existing.departamentoId,
    }
    const { position, department } = await resolveCatalogNames(db, resolveInput)

    if ('cargoId' in input) patch.cargoId = input.cargoId || null
    if ('funcionId' in input) patch.funcionId = input.funcionId || null
    if ('departamentoId' in input) patch.departamentoId = input.departamentoId || null
    patch.position = position
    patch.department = department
  }

  const updated = await updateEmployee(db, id, patch)

  if (input.payrollTypeIds !== undefined) {
    if (input.payrollTypeIds.length === 0) {
      return {
        success: false as const,
        error: 'no_payroll_type',
        message: 'El empleado debe tener al menos un tipo de planilla',
      }
    }
    await setEmployeePayrollTypes(db, id, input.payrollTypeIds)
  }

  return { success: true as const, data: updated }
}

// ─── Deactivate ───────────────────────────────────────────────────────────────

export async function deactivateEmployeeService(db: AnyDb, id: string) {
  const existing = await getEmployee(db, id)
  if (!existing) {
    return { success: false as const, error: 'not_found', message: 'Employee not found' }
  }
  if (!existing.isActive) {
    return {
      success: false as const,
      error: 'already_inactive',
      message: 'Employee is already inactive',
    }
  }
  const updated = await deactivateEmployee(db, id)
  return { success: true as const, data: updated }
}
