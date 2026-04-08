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
  permissions: string[]
}

// ─── Roles ───────────────────────────────────────────────────────────────────

export const USER_ROLES = ['SUPER_ADMIN', 'ADMIN', 'HR', 'ACCOUNTANT', 'VIEWER'] as const
export type UserRole = (typeof USER_ROLES)[number]

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
