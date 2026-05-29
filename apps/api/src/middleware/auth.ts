import { jwt } from '@elysiajs/jwt'
import type { PermissionCode, UserRole } from '@payroll/types'
import { Elysia } from 'elysia'
import { env } from '../config/env'

// ─── Types ────────────────────────────────────────────────────────────────────

export type AuthUser = {
  userId: string
  tenantId: string
  tenantSlug?: string
  role: UserRole
  type: 'user' | 'super_admin' | 'employee'
  /**
   * Employee identity, present only when `type === 'employee'` (JWT minted
   * by the portal login). These tokens carry `employeeId`/`employeeCode`
   * instead of `userId`, and no `permissions` array.
   */
  employeeId?: string
  employeeCode?: string
  name?: string
  email?: string
  /** Effective permission codes pre-computed at login time. */
  permissions?: PermissionCode[]
  /** Snapshot of users.permissions_version at login. */
  permissionsVersion?: number
  /**
   * When set, the JWT was minted by the super-admin impersonation flow:
   * the bearer is acting as a tenant user but the original super-admin
   * identity is preserved here so audit logs and the UI banner can
   * surface it.
   */
  impersonatedBy?: {
    superAdminId: string
    superAdminEmail?: string
  }
}

// ─── JWT plugin (singleton, prevents re-registration) ────────────────────────

export const jwtPlugin = new Elysia({ name: 'jwt-plugin' }).use(
  jwt({
    name: 'jwt',
    secret: env.JWT_SECRET,
    exp: '7d',
  })
)

// ─── Auth derive — decodes cookie and injects `user` into context ─────────────

/**
 * Use this plugin in any Elysia app that needs to know who the current user is.
 * Injects `user: AuthUser | null` into every handler's context.
 *
 * The token is read from the `auth` cookie (browser sessions) OR the
 * `Authorization: Bearer` header (native mobile / API clients, which can't
 * use httpOnly cookies). The cookie takes precedence when both are present.
 *
 * `null` means the request is anonymous (no token or invalid token).
 */
export const authPlugin = new Elysia({ name: 'auth-plugin' })
  .use(jwtPlugin)
  .derive({ as: 'global' }, async ({ jwt, cookie, headers }) => {
    const bearer = headers.authorization?.replace(/^Bearer\s+/i, '')
    const token = cookie.auth?.value ?? bearer
    if (!token) return { user: null as AuthUser | null }

    const payload = await jwt.verify(token)
    if (!payload) return { user: null as AuthUser | null }

    return { user: payload as unknown as AuthUser }
  })

// ─── Guards ───────────────────────────────────────────────────────────────────

/**
 * Middleware that rejects requests without a valid session.
 * Usage: mount before any route that requires authentication.
 */
export function guardAuth({
  user,
  set,
}: {
  user: AuthUser | null
  set: { status: number | string }
}) {
  if (!user) {
    set.status = 401
    return { success: false, error: 'Unauthorized' }
  }
}

/**
 * Reject any request that is not authenticated as a super admin. The JWT's
 * `type` field is the source of truth — a tenant user with role=SUPER_ADMIN
 * (which should never happen) would still be rejected.
 */
export function guardSuperAdmin({
  user,
  set,
}: {
  user: AuthUser | null
  set: { status: number | string }
}) {
  if (!user) {
    set.status = 401
    return { success: false, error: 'Unauthorized' }
  }
  if (user.type !== 'super_admin') {
    set.status = 403
    return { success: false, error: 'Forbidden: super admin only' }
  }
}

// ─── Permission helpers ──────────────────────────────────────────────────────

/**
 * True if the authenticated user holds every requested permission. Super
 * admins implicitly satisfy any tenant-scope permission check; tenant users
 * are evaluated against the `permissions` array stamped into their JWT at
 * login time.
 */
export function userHasPermissions(
  user: AuthUser | null,
  required: readonly PermissionCode[]
): boolean {
  if (!user) return false
  if (user.type === 'super_admin') return true
  if (required.length === 0) return true
  const granted = new Set(user.permissions ?? [])
  return required.every((p) => granted.has(p))
}

/**
 * Returns a `beforeHandle` guard that enforces every supplied permission.
 * Codes are AND-combined — pass multiple calls or use a wrapper if you need
 * OR semantics.
 *
 *   .post('/employees', handler, { beforeHandle: guardPermission('employees:create') })
 */
export function guardPermission(...required: PermissionCode[]) {
  return ({
    user,
    set,
  }: {
    user: AuthUser | null
    set: { status: number | string }
  }) => {
    if (!user) {
      set.status = 401
      return { success: false, error: 'Unauthorized' }
    }
    if (!userHasPermissions(user, required)) {
      set.status = 403
      return {
        success: false,
        error: 'Forbidden: missing permission',
        missing: required.filter((p) => !user.permissions?.includes(p)),
      }
    }
  }
}

/**
 * Returns a `beforeHandle` guard that enforces a minimum role.
 * Role hierarchy: SUPER_ADMIN > ADMIN > HR > ACCOUNTANT > VIEWER
 *
 * @deprecated Prefer guardPermission() — roles are kept for backwards
 * compatibility while existing routes are migrated.
 */
export function guardRole(...requiredRoles: UserRole[]) {
  const HIERARCHY: Record<string, number> = {
    SUPER_ADMIN: 100,
    ADMIN: 80,
    HR: 60,
    ACCOUNTANT: 40,
    VIEWER: 20,
  }

  return ({
    user,
    set,
  }: {
    user: AuthUser | null
    set: { status: number | string }
  }) => {
    if (!user) {
      set.status = 401
      return { success: false, error: 'Unauthorized' }
    }
    const userLevel = HIERARCHY[user.role] ?? 0
    const requiredLevel = Math.min(...requiredRoles.map((r) => HIERARCHY[r] ?? 999))
    if (userLevel < requiredLevel) {
      set.status = 403
      return { success: false, error: 'Forbidden: insufficient role' }
    }
  }
}
