/**
 * Portal auth — login/logout for the employee self-service portal.
 *
 * The portal uses a SEPARATE auth flow from the admin system:
 *   - Login is by cédula (employees.id_number) + password
 *     (employee_credentials.password_hash)
 *   - JWT has type='employee' (not 'user' or 'super_admin')
 *   - Cookie name is 'portal_auth' (not 'auth') so both sessions
 *     can coexist in the same browser
 *
 * Endpoints:
 *   POST /portal/auth/login   — authenticate employee by cédula
 *   POST /portal/auth/logout  — clear portal session
 *   GET  /portal/auth/me      — get current employee info
 */
import { employeeCredentials, employees } from '@payroll/db'
import { eq } from 'drizzle-orm'
import { Elysia, t } from 'elysia'
import { verifyPassword } from '../../lib/password'
import { jwtPlugin } from '../../middleware/auth'
import { tenantPlugin } from '../../middleware/tenant'

// biome-ignore lint/suspicious/noExplicitAny: drizzle generic
type AnyDb = any

const MAX_FAILED_ATTEMPTS = 5

export const portalAuthRoutes = new Elysia({ prefix: '/portal/auth' })
  .use(jwtPlugin)
  .use(tenantPlugin)

  .post(
    '/login',
    async ({ db, body, jwt, cookie, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }

      const idNumber = body.idNumber.trim()
      const password = body.password

      // Find employee by cédula
      const [emp] = await (db as AnyDb)
        .select({
          id: employees.id,
          code: employees.code,
          firstName: employees.firstName,
          lastName: employees.lastName,
          idNumber: employees.idNumber,
          departmentId: employees.departmentId,
          isActive: employees.isActive,
        })
        .from(employees)
        .where(eq(employees.idNumber, idNumber))
        .limit(1)

      if (!emp || !emp.isActive) {
        set.status = 401
        return { success: false, error: 'Cédula o contraseña incorrecta.' }
      }

      // Find credentials
      const [cred] = await (db as AnyDb)
        .select()
        .from(employeeCredentials)
        .where(eq(employeeCredentials.employeeId, emp.id))
        .limit(1)

      if (!cred || !cred.isActive) {
        set.status = 401
        return { success: false, error: 'No tiene acceso al portal. Contacte a Recursos Humanos.' }
      }

      if (cred.isLocked || cred.failedAttempts >= MAX_FAILED_ATTEMPTS) {
        set.status = 423
        return {
          success: false,
          error: 'Cuenta bloqueada por intentos fallidos. Contacte a Recursos Humanos.',
        }
      }

      const valid = await verifyPassword(password, cred.passwordHash)
      if (!valid) {
        await (db as AnyDb)
          .update(employeeCredentials)
          .set({
            failedAttempts: cred.failedAttempts + 1,
            isLocked: cred.failedAttempts + 1 >= MAX_FAILED_ATTEMPTS,
            updatedAt: new Date(),
          })
          .where(eq(employeeCredentials.id, cred.id))

        set.status = 401
        return { success: false, error: 'Cédula o contraseña incorrecta.' }
      }

      // Success — reset failed attempts + update last login
      await (db as AnyDb)
        .update(employeeCredentials)
        .set({
          failedAttempts: 0,
          lastLoginAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(employeeCredentials.id, cred.id))

      const token = await jwt.sign({
        type: 'employee',
        employeeId: emp.id,
        employeeCode: emp.code,
        name: `${emp.firstName} ${emp.lastName}`,
        idNumber: emp.idNumber,
        departmentId: emp.departmentId ?? null,
        tenantSlug: cookie.auth?.value
          ? (() => {
              try {
                const parts = (cookie.auth.value as string).split('.')
                if (parts.length === 3) {
                  const p = JSON.parse(Buffer.from(parts[1], 'base64').toString())
                  return p.tenantSlug ?? 'demo'
                }
              } catch {}
              return 'demo'
            })()
          : 'demo',
        exp: Math.floor(Date.now() / 1000) + 8 * 3600, // 8 hours
      })

      cookie.portal_auth.set({
        value: token,
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 8 * 3600,
      })

      return {
        success: true,
        data: {
          employeeId: emp.id,
          code: emp.code,
          name: `${emp.firstName} ${emp.lastName}`,
        },
      }
    },
    {
      body: t.Object({
        idNumber: t.String({ minLength: 1 }),
        password: t.String({ minLength: 1 }),
      }),
    }
  )

  .post('/logout', ({ cookie }) => {
    cookie.portal_auth.remove()
    return { success: true }
  })

  .get('/me', async ({ db, cookie, jwt, set }) => {
    const token = cookie.portal_auth?.value
    if (!token) {
      set.status = 401
      return { success: false, error: 'Not authenticated' }
    }

    const payload = await jwt.verify(token)
    if (!payload || payload.type !== 'employee') {
      set.status = 401
      return { success: false, error: 'Invalid session' }
    }

    return {
      success: true,
      data: {
        employeeId: payload.employeeId,
        employeeCode: payload.employeeCode,
        name: payload.name,
        departmentId: payload.departmentId,
      },
    }
  })
