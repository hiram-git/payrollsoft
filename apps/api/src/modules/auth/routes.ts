import { Elysia, t } from 'elysia'
import { env } from '../../config/env'
import { authPlugin, guardAuth, jwtPlugin } from '../../middleware/auth'
import { loginRateLimit } from '../../middleware/rateLimit'
import { cookieOptions, verifySuperAdminLogin, verifyTenantLogin } from './service'

/**
 * Auth routes — mounted at /auth
 *
 * POST /auth/login          → tenant user login
 * POST /auth/superadmin/login → super admin login
 * POST /auth/logout         → clear cookie
 * GET  /auth/me             → current user info
 */
export const authRoutes = new Elysia({ prefix: '/auth' })
  .use(jwtPlugin)
  .use(authPlugin)

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
