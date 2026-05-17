import { z } from 'zod'

// ─── Pagination ───────────────────────────────────────────────────────────────

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

export type Pagination = z.infer<typeof paginationSchema>

export type PaginatedResponse<T> = {
  data: T[]
  total: number
  page: number
  limit: number
  totalPages: number
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
})

export type LoginInput = z.infer<typeof loginSchema>

export type JwtPayload = {
  userId: string
  tenantId: string
  role: UserRole
  permissions: PermissionCode[]
}

// ─── Roles ───────────────────────────────────────────────────────────────────

export const USER_ROLES = ['SUPER_ADMIN', 'ADMIN', 'HR', 'ACCOUNTANT', 'VIEWER'] as const
export type UserRole = (typeof USER_ROLES)[number]

// ─── Permissions catalog (mirror of payroll_auth.permissions_catalog) ────────

/**
 * Canonical list of permission codes recognized by the application. The DB
 * catalog is the authoritative source at runtime, but this constant gives us
 * compile-time safety in handlers and UI.
 *
 * Keep in sync with packages/db/drizzle/public/0002_permissions_catalog.sql.
 */
export const PERMISSION_CODES = [
  // Employees / positions / shifts
  'employees:create',
  'employees:read',
  'employees:update',
  'employees:delete',
  'employees:import',
  'employees:export',
  'positions:create',
  'positions:read',
  'positions:update',
  'positions:delete',
  'shifts:create',
  'shifts:read',
  'shifts:update',
  'shifts:delete',
  'shifts:assign',
  // Attendance & vacations
  'attendance:read',
  'attendance:mark',
  'attendance:import',
  'attendance:edit',
  'attendance:approve',
  'vacations:request',
  'vacations:read',
  'vacations:approve',
  'vacations:reject',
  'vacations:cancel',
  // Loans / advances / creditors
  'loans:create',
  'loans:read',
  'loans:update',
  'loans:approve',
  'loans:reject',
  'loans:cancel',
  'advances:create',
  'advances:read',
  'advances:approve',
  'advances:reject',
  'creditors:create',
  'creditors:read',
  'creditors:update',
  'creditors:delete',
  // Payroll / concepts / catalogs
  'payroll:create',
  'payroll:read',
  'payroll:generate',
  'payroll:recalculate',
  'payroll:approve',
  'payroll:close',
  'payroll:reopen',
  'payroll:export',
  'concepts:create',
  'concepts:read',
  'concepts:update',
  'concepts:delete',
  'catalogs:create',
  'catalogs:read',
  'catalogs:update',
  'catalogs:delete',
  // Payslips
  'payslip:read',
  'payslip:download',
  'payslip:send_email',
  'payslip:resend',
  // Reports
  'reports:payroll.view',
  'reports:payroll.export',
  'reports:personnel.view',
  'reports:personnel.export',
  'reports:attendance.view',
  'reports:attendance.export',
  'reports:loans.view',
  // Tenant administration
  'users:create',
  'users:read',
  'users:update',
  'users:deactivate',
  'roles:create',
  'roles:read',
  'roles:update',
  'roles:delete',
  'roles:assign',
  'settings:company.read',
  'settings:company.update',
  'audit:read',
  // Employee files (expedientes)
  'employee_files:read',
  'employee_files:write',
  'employee_files:delete',
  // Global (super-admin only)
  'tenants:create',
  'tenants:read',
  'tenants:update',
  'tenants:suspend',
  'tenants:archive',
  'super_admins:create',
  'super_admins:read',
  'super_admins:update',
  'super_admins:deactivate',
] as const

export type PermissionCode = (typeof PERMISSION_CODES)[number]

const TENANT_PERMISSION_MODULES = new Set([
  'employees',
  'positions',
  'shifts',
  'attendance',
  'vacations',
  'loans',
  'advances',
  'creditors',
  'payroll',
  'concepts',
  'catalogs',
  'payslip',
  'reports',
  'users',
  'roles',
  'settings',
  'audit',
])

/** Returns true if a code is in the global (super-admin) scope. */
export function isGlobalPermission(code: PermissionCode): boolean {
  const module = code.split(':')[0]
  return !TENANT_PERMISSION_MODULES.has(module)
}

// ─── System role definitions ─────────────────────────────────────────────────

/**
 * Roles seeded into every freshly-provisioned tenant. These are marked
 * `is_system = true` in the roles table and cannot be deleted from the UI;
 * tenants can layer custom roles on top via inheritance.
 */
export const SYSTEM_ROLE_CODES = ['tenant_admin', 'hr', 'accountant', 'viewer'] as const
export type SystemRoleCode = (typeof SYSTEM_ROLE_CODES)[number]

export type SystemRoleDefinition = {
  code: SystemRoleCode
  name: string
  description: string
  /** Codes from the permissions catalog this role grants by default. */
  permissions: readonly PermissionCode[]
}

const ALL_TENANT_PERMISSIONS = PERMISSION_CODES.filter((c) => !isGlobalPermission(c))

const HR_PERMISSIONS: readonly PermissionCode[] = [
  'employees:create',
  'employees:read',
  'employees:update',
  'employees:export',
  'employees:import',
  'positions:create',
  'positions:read',
  'positions:update',
  'shifts:create',
  'shifts:read',
  'shifts:update',
  'shifts:assign',
  'attendance:read',
  'attendance:mark',
  'attendance:edit',
  'attendance:approve',
  'attendance:import',
  'vacations:read',
  'vacations:request',
  'vacations:approve',
  'vacations:reject',
  'vacations:cancel',
  'loans:create',
  'loans:read',
  'loans:update',
  'advances:create',
  'advances:read',
  'creditors:read',
  'payroll:read',
  'concepts:read',
  'catalogs:read',
  'payslip:read',
  'payslip:download',
  'payslip:send_email',
  'reports:personnel.view',
  'reports:personnel.export',
  'reports:attendance.view',
  'reports:attendance.export',
]

const ACCOUNTANT_PERMISSIONS: readonly PermissionCode[] = [
  'employees:read',
  'positions:read',
  'shifts:read',
  'attendance:read',
  'loans:read',
  'loans:approve',
  'advances:read',
  'advances:approve',
  'creditors:read',
  'creditors:create',
  'creditors:update',
  'payroll:read',
  'payroll:create',
  'payroll:generate',
  'payroll:recalculate',
  'payroll:approve',
  'payroll:close',
  'payroll:export',
  'concepts:read',
  'concepts:create',
  'concepts:update',
  'catalogs:read',
  'catalogs:create',
  'catalogs:update',
  'payslip:read',
  'payslip:download',
  'payslip:send_email',
  'reports:payroll.view',
  'reports:payroll.export',
  'reports:loans.view',
]

const VIEWER_PERMISSIONS: readonly PermissionCode[] = [
  'employees:read',
  'positions:read',
  'shifts:read',
  'attendance:read',
  'vacations:read',
  'loans:read',
  'advances:read',
  'creditors:read',
  'payroll:read',
  'concepts:read',
  'catalogs:read',
  'payslip:read',
  'reports:payroll.view',
  'reports:personnel.view',
  'reports:attendance.view',
]

export const SYSTEM_ROLES: readonly SystemRoleDefinition[] = [
  {
    code: 'tenant_admin',
    name: 'Administrador',
    description: 'Acceso total a la empresa: usuarios, roles, planillas y configuración.',
    permissions: ALL_TENANT_PERMISSIONS,
  },
  {
    code: 'hr',
    name: 'Recursos Humanos',
    description: 'Gestión de empleados, asistencias, vacaciones y comprobantes.',
    permissions: HR_PERMISSIONS,
  },
  {
    code: 'accountant',
    name: 'Contabilidad',
    description: 'Generación, aprobación y cierre de planillas; conceptos y reportes contables.',
    permissions: ACCOUNTANT_PERMISSIONS,
  },
  {
    code: 'viewer',
    name: 'Solo lectura',
    description: 'Consulta de información sin permisos de edición.',
    permissions: VIEWER_PERMISSIONS,
  },
]

export function getSystemRole(code: SystemRoleCode): SystemRoleDefinition {
  // biome-ignore lint/style/noNonNullAssertion: codes come from the const tuple above
  return SYSTEM_ROLES.find((r) => r.code === code)!
}

// ─── Employee ─────────────────────────────────────────────────────────────────

export const PAY_FREQUENCIES = ['biweekly', 'monthly', 'weekly'] as const
export type PayFrequency = (typeof PAY_FREQUENCIES)[number]

export const createEmployeeSchema = z.object({
  code: z.string().min(1).max(50),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  idNumber: z.string().min(1).max(20),
  socialSecurityNumber: z.string().max(20).optional(),
  email: z.string().email().optional(),
  phone: z.string().max(20).optional(),
  position: z.string().max(100).optional(),
  department: z.string().max(100).optional(),
  hireDate: z.string().date(),
  baseSalary: z.string().regex(/^\d+(\.\d{1,2})?$/, 'Invalid salary format'),
  payFrequency: z.enum(PAY_FREQUENCIES).default('biweekly'),
  customFields: z.record(z.unknown()).optional(),
})

export type CreateEmployeeInput = z.infer<typeof createEmployeeSchema>

// ─── Payroll ─────────────────────────────────────────────────────────────────

export const PAYROLL_TYPES = ['regular', 'thirteenth', 'special'] as const
export type PayrollType = (typeof PAYROLL_TYPES)[number]

export const PAYROLL_STATUSES = ['draft', 'processing', 'approved', 'paid'] as const
export type PayrollStatus = (typeof PAYROLL_STATUSES)[number]

export const createPayrollSchema = z.object({
  name: z.string().min(1).max(255),
  type: z.enum(PAYROLL_TYPES),
  frequency: z.enum(PAY_FREQUENCIES),
  periodStart: z.string().date(),
  periodEnd: z.string().date(),
  paymentDate: z.string().date().optional(),
})

export type CreatePayrollInput = z.infer<typeof createPayrollSchema>

// ─── API Response ─────────────────────────────────────────────────────────────

export type ApiSuccess<T> = { success: true; data: T }
export type ApiError = { success: false; error: string; details?: unknown }
export type ApiResponse<T> = ApiSuccess<T> | ApiError
