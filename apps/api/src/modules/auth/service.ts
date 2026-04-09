import { findSuperAdminByEmail, findUserByEmail } from '@payroll/db'
import { verifyPassword } from '../../lib/password'
import type { AuthUser } from '../../middleware/auth'

// biome-ignore lint/suspicious/noExplicitAny: intentional generic DB type
type AnyDb = any

/**
 * Verify tenant user credentials.
 * Returns AuthUser on success, null on failure.
 */
export async function verifyTenantLogin(
  db: AnyDb,
  email: string,
  password: string,
  tenantId: string
): Promise<AuthUser | null> {
  const user = await findUserByEmail(db, email)
  if (!user || !user.isActive) return null

  const valid = await verifyPassword(password, user.passwordHash)
  if (!valid) return null

  return {
    userId: user.id,
    tenantId,
    role: user.role as AuthUser['role'],
    type: 'user',
  }
}

/**
 * Verify super admin credentials (public schema).
 */
export async function verifySuperAdminLogin(
  publicDb: AnyDb,
  email: string,
  password: string
): Promise<AuthUser | null> {
  const admin = await findSuperAdminByEmail(publicDb, email)
  if (!admin || !admin.isActive) return null

  const valid = await verifyPassword(password, admin.passwordHash)
  if (!valid) return null

  return {
    userId: admin.id,
    tenantId: '*',
    role: 'SUPER_ADMIN' as AuthUser['role'],
    type: 'super_admin',
  }
}

/**
 * Build cookie options for the auth JWT.
 */
export function cookieOptions(isProduction: boolean) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: 7 * 24 * 60 * 60,
    secure: isProduction,
  }
}
