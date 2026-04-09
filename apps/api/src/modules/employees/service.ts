import {
  createEmployee,
  deactivateEmployee,
  getEmployee,
  getEmployeeByCode,
  listEmployees,
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
  position?: string | null
  department?: string | null
  hireDate: string
  baseSalary: string
  payFrequency?: 'biweekly' | 'monthly' | 'weekly'
  customFields?: Record<string, unknown>
}

export type EmployeeUpdateInput = Partial<EmployeeCreateInput>

// ─── List ─────────────────────────────────────────────────────────────────────

export function listEmployeesService(
  db: AnyDb,
  filter: { search?: string; department?: string; isActive?: boolean; payFrequency?: string },
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

  const employee = await createEmployee(db, {
    code: input.code.trim().toUpperCase(),
    firstName: input.firstName.trim(),
    lastName: input.lastName.trim(),
    idNumber: input.idNumber.trim(),
    socialSecurityNumber: input.socialSecurityNumber?.trim() || null,
    email: input.email?.trim().toLowerCase() || null,
    phone: input.phone?.trim() || null,
    position: input.position?.trim() || null,
    department: input.department?.trim() || null,
    hireDate: input.hireDate,
    baseSalary: input.baseSalary,
    payFrequency: input.payFrequency ?? 'biweekly',
    customFields: input.customFields ?? {},
  })

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
  if (input.position !== undefined) patch.position = input.position?.trim() || null
  if (input.department !== undefined) patch.department = input.department?.trim() || null
  if (input.hireDate !== undefined) patch.hireDate = input.hireDate
  if (input.baseSalary !== undefined) patch.baseSalary = input.baseSalary
  if (input.payFrequency !== undefined) patch.payFrequency = input.payFrequency
  if (input.customFields !== undefined) patch.customFields = input.customFields

  const updated = await updateEmployee(db, id, patch)
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
