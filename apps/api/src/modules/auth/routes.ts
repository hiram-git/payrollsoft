import { Elysia, t } from 'elysia'
import { env } from '../../config/env'
import { authPlugin, guardAuth, jwtPlugin } from '../../middleware/auth'
import { loginRateLimit } from '../../middleware/rateLimit'
import { tenantPlugin } from '../../middleware/tenant'
import {
  consumePasswordResetToken,
  requestPasswordReset,
  verifyPasswordResetToken,
} from './password-reset-service'
import { cookieOptions, verifySuperAdminLogin, verifyTenantLogin } from './service'

/**
 * Auth routes — mounted at /auth
 *
 * POST /auth/login                  → tenant user login
 * POST /auth/superadmin/login        → super admin login
 * POST /auth/logout                  → clear cookie
 * GET  /auth/me                      → current user info
 * POST /auth/forgot-password         → email a reset link (always 200)
 * GET  /auth/reset-password/:token   → check if a token is redeemable
 * POST /auth/reset-password          → consume a token + set new password
 */
export const authRoutes = new Elysia({ prefix: '/auth' })
  .use(jwtPlugin)
  .use(authPlugin)
  .use(tenantPlugin)

  // ── POST /auth/login ────────────────────────────────────────────────────────
  .post(
    '/login',
    async ({ jwt, body, cookie: { auth }, db, tenantSlug, set }) => {
      if (!tenantSlug) {
        set.status = 400
        return { success: false, error: 'Tenant not identified. Use X-Tenant header.' }
      }

      const authUser = await verifyTenantLogin(db, body.email, body.password, tenantSlug)
      if (!authUser) {
        set.status = 401
        return { success: false, error: 'Invalid email or password' }
      }

      const token = await jwt.sign(authUser)

      auth.set({
        value: token,
        ...cookieOptions(env.NODE_ENV === 'production'),
      })

      return {
        success: true,
        data: {
          userId: authUser.userId,
          role: authUser.role,
          tenantId: authUser.tenantId,
        },
      }
    },
    {
      beforeHandle: [loginRateLimit],
      body: t.Object({
        email: t.String({ format: 'email' }),
        password: t.String({ minLength: 8 }),
      }),
    }
  )

  // ── POST /auth/superadmin/login ─────────────────────────────────────────────
  .post(
    '/superadmin/login',
    async ({ jwt, body, cookie: { auth }, set }) => {
      const { publicDb } = await import('../../config/db')

      const authUser = await verifySuperAdminLogin(publicDb, body.email, body.password)
      if (!authUser) {
        set.status = 401
        return { success: false, error: 'Invalid credentials' }
      }

      const token = await jwt.sign(authUser)

      auth.set({
        value: token,
        ...cookieOptions(env.NODE_ENV === 'production'),
      })

      return {
        success: true,
        data: { userId: authUser.userId, role: 'SUPER_ADMIN' },
      }
    },
    {
      beforeHandle: [loginRateLimit],
      body: t.Object({
        email: t.String({ format: 'email' }),
        password: t.String({ minLength: 8 }),
      }),
    }
  )

  // ── POST /auth/logout ────────────────────────────────────────────────────────
  .post('/logout', ({ cookie: { auth } }) => {
    auth.set({ value: '', maxAge: 0, path: '/' })
    return { success: true, message: 'Logged out' }
  })

  // ── GET /auth/me ─────────────────────────────────────────────────────────────
  .get(
    '/me',
    ({ user }) => ({
      success: true,
      data: user,
    }),
    {
      beforeHandle: [guardAuth],
    }
  )

  // ── POST /auth/forgot-password ──────────────────────────────────────────────
  // Always answers `{ success: true }` regardless of whether the email
  // matches a real account — this prevents user-enumeration attacks.
  // Mail-transport failures are logged server-side but never exposed.
  .post(
    '/forgot-password',
    async ({ body, db, tenantSlug, set }) => {
      if (!tenantSlug) {
        set.status = 400
        return { success: false, error: 'Tenant not identified. Use X-Tenant header.' }
      }
      const result = await requestPasswordReset(db, tenantSlug, body.email)
      if (result.kind === 'mail_error') {
        console.error('Password reset mail error:', result.message)
      }
      return { success: true }
    },
    {
      beforeHandle: [loginRateLimit],
      body: t.Object({
        email: t.String({ format: 'email' }),
      }),
    }
  )

  // ── GET /auth/reset-password/:token ─────────────────────────────────────────
  // Pre-flight check the reset page calls so it can render a friendly
  // error before showing the password form. Returns the token state but
  // never the user's identity.
  .get('/reset-password/:token', async ({ params, db, tenantSlug, set }) => {
    if (!tenantSlug) {
      set.status = 400
      return { success: false, error: 'Tenant not identified. Use X-Tenant header.' }
    }
    const result = await verifyPasswordResetToken(db, params.token)
    if (result.kind !== 'ok') {
      set.status = 410
      return { success: false, error: result.kind }
    }
    return { success: true }
  })

  // ── POST /auth/reset-password ───────────────────────────────────────────────
  // Consume a token and persist the new password hash. Single-use: the
  // row is marked `used_at = now()` so a leaked link can't be replayed.
  .post(
    '/reset-password',
    async ({ body, db, tenantSlug, set }) => {
      if (!tenantSlug) {
        set.status = 400
        return { success: false, error: 'Tenant not identified. Use X-Tenant header.' }
      }
      const result = await consumePasswordResetToken(db, body.token, body.password)
      if (result.kind !== 'ok') {
        set.status = 410
        return { success: false, error: result.kind }
      }
      return { success: true }
    },
    {
      beforeHandle: [loginRateLimit],
      body: t.Object({
        token: t.String({ minLength: 32 }),
        password: t.String({ minLength: 8, maxLength: 256 }),
      }),
    }
  )
