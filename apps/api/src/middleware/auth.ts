import { jwt } from '@elysiajs/jwt'
import type { UserRole } from '@payroll/types'
import { Elysia } from 'elysia'
import { env } from '../config/env'

// ─── Types ────────────────────────────────────────────────────────────────────

export type AuthUser = {
  userId: string
  tenantId: string
  role: UserRole
  type: 'user' | 'super_admin'
  name?: string
  email?: string
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
 * `null` means the request is anonymous (no cookie or invalid token).
 */
export const authPlugin = new Elysia({ name: 'auth-plugin' })
  .use(jwtPlugin)
  .derive({ as: 'global' }, async ({ jwt, cookie }) => {
    const token = cookie.auth?.value
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
 * Returns a `beforeHandle` guard that enforces a minimum role.
 * Role hierarchy: SUPER_ADMIN > ADMIN > HR > ACCOUNTANT > VIEWER
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
