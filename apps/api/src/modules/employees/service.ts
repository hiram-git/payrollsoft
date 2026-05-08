import { findMissingRequired } from '@payroll/core'
import {
  createEmployee,
  customFieldDefinitions,
  customFieldValueHistory,
  deactivateEmployee,
  getCargoById,
  getDefaultPayrollType,
  getDepartamentoById,
  getEmployee,
  getEmployeeByCode,
  getFuncionById,
  listEmployees,
  recomputePositionStatus,
  setEmployeePayrollTypes,
  updateEmployee,
} from '@payroll/db'
import type { PaginationOptions } from '@payroll/db'
import { desc, eq } from 'drizzle-orm'

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

// ─── Custom field dependency validation ──────────────────────────────────────

/**
 * Lee las definiciones activas y corre el evaluador de dependencias
 * para confirmar que todos los campos `required` (y `visible`) tengan
 * valor en el payload combinado. Devuelve los códigos faltantes — cuando
 * está vacío, el patch es válido.
 */
async function findMissingRequiredCustomFields(
  db: AnyDb,
  values: Record<string, unknown>
): Promise<string[]> {
  const defs = await db
    .select()
    .from(customFieldDefinitions)
    .where(eq(customFieldDefinitions.isActive, true))
  return findMissingRequired(
    defs as Array<Parameters<typeof findMissingRequired>[0][number]>,
    values
  )
}

/**
 * Detecta campos cuyo `validationRules.writePermission` el usuario no
 * posee y que aparecerían modificados en el patch. Devuelve la lista
 * de códigos no permitidos para que el caller pueda rechazar la op.
 *
 * `userPermissions` viene tipado laxo para evitar enredo con el catálogo
 * de PermissionCode aquí (la API ya garantiza que los strings son del
 * catálogo en otras partes).
 */
async function findForbiddenCustomFieldWrites(
  db: AnyDb,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  userPermissions: ReadonlySet<string>,
  isSuperAdmin: boolean
): Promise<string[]> {
  if (isSuperAdmin) return []
  // biome-ignore lint/suspicious/noExplicitAny: drizzle row
  const defs: any[] = await db.select().from(customFieldDefinitions)
  const blocked: string[] = []
  for (const def of defs) {
    const rules = def.validationRules
    const perm =
      rules &&
      typeof rules === 'object' &&
      typeof (rules as Record<string, unknown>).writePermission === 'string'
        ? ((rules as Record<string, unknown>).writePermission as string)
        : null
    if (!perm || perm.length === 0) continue
    if (userPermissions.has(perm)) continue
    const wasSet = Object.prototype.hasOwnProperty.call(before, def.code)
    const willSet = Object.prototype.hasOwnProperty.call(after, def.code)
    if (!wasSet && !willSet) continue
    const beforeVal = before[def.code] ?? null
    const afterVal = after[def.code] ?? null
    if (JSON.stringify(beforeVal) === JSON.stringify(afterVal)) continue
    blocked.push(def.code)
  }
  return blocked
}

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

export async function createEmployeeService(
  db: AnyDb,
  input: EmployeeCreateInput,
  options: { userPermissions?: ReadonlySet<string>; isSuperAdmin?: boolean } = {}
) {
  const existingCode = await getEmployeeByCode(db, input.code)
  if (existingCode) {
    return {
      success: false as const,
      error: 'code_taken',
      message: `Code "${input.code}" is already in use`,
    }
  }

  const { position, department } = await resolveCatalogNames(db, input)

  if (input.customFields !== undefined) {
    const missing = await findMissingRequiredCustomFields(db, input.customFields ?? {})
    if (missing.length > 0) {
      return {
        success: false as const,
        error: 'custom_field_required',
        message: `Falta(n) campo(s) obligatorio(s): ${missing.join(', ')}`,
      }
    }
    const forbidden = await findForbiddenCustomFieldWrites(
      db,
      {},
      (input.customFields ?? {}) as Record<string, unknown>,
      options.userPermissions ?? new Set(),
      options.isSuperAdmin ?? false
    )
    if (forbidden.length > 0) {
      return {
        success: false as const,
        error: 'custom_field_forbidden',
        message: `No tienes permiso para escribir: ${forbidden.join(', ')}`,
      }
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

  // Newly assigned position flips to 'en_uso' automatically.
  await recomputePositionStatus(db, employee.positionId)

  return { success: true as const, data: employee }
}

// ─── Update ───────────────────────────────────────────────────────────────────

export async function updateEmployeeService(
  db: AnyDb,
  id: string,
  input: EmployeeUpdateInput,
  options: {
    changedBy?: string
    userPermissions?: ReadonlySet<string>
    isSuperAdmin?: boolean
  } = {}
) {
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

  const previousPositionId = existing.positionId ?? null
  // Capturar customFields previos para el diff de auditoría —
  // cualquier cambio se persiste en custom_field_value_history.
  const prevCustomFields = (existing.customFields ?? {}) as Record<string, unknown>

  // Si el payload trae customFields, validar dependencias contra el
  // estado MERGEADO con lo que ya tenía el empleado: los campos no
  // tocados deben permanecer disponibles para satisfacer "required-if".
  if (input.customFields !== undefined) {
    const incoming = (input.customFields ?? {}) as Record<string, unknown>
    const merged = { ...prevCustomFields, ...incoming }
    const missing = await findMissingRequiredCustomFields(db, merged)
    if (missing.length > 0) {
      return {
        success: false as const,
        error: 'custom_field_required',
        message: `Falta(n) campo(s) obligatorio(s): ${missing.join(', ')}`,
      }
    }
    const forbidden = await findForbiddenCustomFieldWrites(
      db,
      prevCustomFields,
      merged,
      options.userPermissions ?? new Set(),
      options.isSuperAdmin ?? false
    )
    if (forbidden.length > 0) {
      return {
        success: false as const,
        error: 'custom_field_forbidden',
        message: `No tienes permiso para escribir: ${forbidden.join(', ')}`,
      }
    }
  }

  const updated = await updateEmployee(db, id, patch)

  if (input.customFields !== undefined) {
    await recordCustomFieldHistory(
      db,
      id,
      prevCustomFields,
      (input.customFields ?? {}) as Record<string, unknown>,
      options.changedBy ?? null
    )
  }

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

  // Reconcile position status on both ends of the change. The newly
  // assigned position flips to 'en_uso' (or stays there if it was
  // already occupied by someone else); the previous position drops
  // back to 'vacante' once the last active employee leaves it.
  const nextPositionId = updated?.positionId ?? null
  if (previousPositionId !== nextPositionId) {
    await recomputePositionStatus(db, previousPositionId)
  }
  await recomputePositionStatus(db, nextPositionId)

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
  // Frees the position automatically — it stays 'en_uso' only while at
  // least one *active* employee references it.
  await recomputePositionStatus(db, existing.positionId ?? null)
  return { success: true as const, data: updated }
}

// ─── Custom field value history ───────────────────────────────────────────────

/**
 * Comparación deep-equal sencilla para detectar cambios reales en
 * valores escalares + objetos/arrays vía JSON.stringify. Suficiente
 * para los 4 tipos del catálogo (text/integer/float/date) que se
 * almacenan como primitivos.
 */
function changed(a: unknown, b: unknown): boolean {
  if (a === b) return false
  if (a == null && b == null) return false
  return JSON.stringify(a ?? null) !== JSON.stringify(b ?? null)
}

/**
 * Diff de los dos diccionarios `customFields` (antes/después) e
 * inserta una fila por cada código que cambió. Acepta valores
 * añadidos (oldValue=null) y removidos (newValue=null).
 */
async function recordCustomFieldHistory(
  db: AnyDb,
  employeeId: string,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  changedBy: string | null
): Promise<void> {
  const codes = new Set<string>([...Object.keys(before), ...Object.keys(after)])
  const rows: Array<{
    employeeId: string
    fieldCode: string
    oldValue: unknown
    newValue: unknown
    changedBy: string | null
  }> = []
  for (const code of codes) {
    const oldV = before[code] ?? null
    const newV = after[code] ?? null
    if (!changed(oldV, newV)) continue
    rows.push({
      employeeId,
      fieldCode: code,
      oldValue: oldV,
      newValue: newV,
      changedBy,
    })
  }
  if (rows.length === 0) return
  await db.insert(customFieldValueHistory).values(rows)
}

/**
 * Lee el historial de cambios de campos adicionales para un empleado,
 * ordenado del más reciente al más antiguo.
 */
export async function listCustomFieldHistoryService(db: AnyDb, employeeId: string, limit = 100) {
  return db
    .select()
    .from(customFieldValueHistory)
    .where(eq(customFieldValueHistory.employeeId, employeeId))
    .orderBy(desc(customFieldValueHistory.changedAt))
    .limit(Math.max(1, Math.min(500, limit)))
}
