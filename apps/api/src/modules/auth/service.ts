import { findSuperAdminByEmail, findUserByEmail, getEffectivePermissions } from '@payroll/db'
import { verifyPassword } from '../../lib/password'
import type { AuthUser } from '../../middleware/auth'

// biome-ignore lint/suspicious/noExplicitAny: intentional generic DB type
type AnyDb = any

/**
 * Verify tenant user credentials. On success, resolves the user's effective
 * permissions (roles + inherited roles) so the caller can stamp them into
 * the JWT for fast authorization checks on every subsequent request.
 *
 * `tenantSlug` is the URL/header-derived tenant identifier; we copy it into
 * the AuthUser so middleware can compare it against future requests and
 * detect cross-tenant token replay.
 */
export async function verifyTenantLogin(
  db: AnyDb,
  email: string,
  password: string,
  tenantSlug: string
): Promise<AuthUser | null> {
  const user = await findUserByEmail(db, email)
  if (!user || !user.isActive) return null

  const valid = await verifyPassword(password, user.passwordHash)
  if (!valid) return null

  const effective = await getEffectivePermissions(db, user.id)

  return {
    userId: user.id,
    tenantId: tenantSlug,
    tenantSlug,
    role: user.role as AuthUser['role'],
    type: 'user',
    name: user.name ?? undefined,
    email: user.email ?? undefined,
    permissions: effective.permissions,
    permissionsVersion: effective.permissionsVersion,
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
    name: admin.name ?? undefined,
    email: admin.email ?? undefined,
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
