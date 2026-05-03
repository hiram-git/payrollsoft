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
