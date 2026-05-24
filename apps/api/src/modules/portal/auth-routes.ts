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
import { companyConfig, employeeCredentials, employees } from '@payroll/db'
import { eq } from 'drizzle-orm'
import { Elysia, t } from 'elysia'
import { env } from '../../config/env'
import { mailerConfigFromCompany, sendMail } from '../../lib/mailer'
import { hashPassword, verifyPassword } from '../../lib/password'
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
        isApprover: cred.isApprover ?? false,
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

  .post(
    '/forgot-password',
    async ({ db, body, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }

      const idNumber = body.idNumber.trim()

      const [emp] = await (db as AnyDb)
        .select({ id: employees.id, email: employees.email, firstName: employees.firstName })
        .from(employees)
        .where(eq(employees.idNumber, idNumber))
        .limit(1)

      if (!emp || !emp.email) {
        return {
          success: true,
          message: 'Si la cédula está registrada con un correo, recibirás instrucciones.',
        }
      }

      const [cred] = await (db as AnyDb)
        .select()
        .from(employeeCredentials)
        .where(eq(employeeCredentials.employeeId, emp.id))
        .limit(1)

      if (!cred || !cred.isActive) {
        return {
          success: true,
          message: 'Si la cédula está registrada con un correo, recibirás instrucciones.',
        }
      }

      const token = `${crypto.randomUUID()}-${crypto.randomUUID()}`
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000)

      await (db as AnyDb)
        .update(employeeCredentials)
        .set({ resetToken: token, resetTokenExpiresAt: expiresAt, updatedAt: new Date() })
        .where(eq(employeeCredentials.id, cred.id))

      const [[company]] = await Promise.all([(db as AnyDb).select().from(companyConfig).limit(1)])
      const mailer = mailerConfigFromCompany(company ?? null)
      if (mailer) {
        const resetUrl = `${env.WEB_URL}/portal/reset-password?token=${encodeURIComponent(token)}`
        const companyName = company?.companyName ?? 'PayrollSoft'
        const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:sans-serif;color:#333;max-width:600px;margin:0 auto;padding:24px;">
<div style="border-bottom:2px solid #003087;padding-bottom:12px;margin-bottom:20px;">
  <strong style="color:#003087;">${companyName}</strong> — Portal del Colaborador
</div>
<h2 style="font-size:18px;margin:0 0 16px;">Recuperar contraseña</h2>
<p>Hola ${emp.firstName}, recibimos una solicitud para restablecer tu contraseña del portal.</p>
<p><a href="${resetUrl}" style="display:inline-block;padding:12px 24px;background:#003087;color:#fff;text-decoration:none;border-radius:4px;font-weight:bold;">Restablecer contraseña</a></p>
<p style="font-size:13px;color:#666;margin-top:16px;">Este enlace expira en <strong>1 hora</strong>. Si no solicitaste este cambio, ignora este correo.</p>
<div style="margin-top:32px;padding-top:16px;border-top:1px solid #eee;font-size:12px;color:#888;">
  Este correo fue generado automáticamente por PayrollSoft.
</div>
</body></html>`
        await sendMail(mailer, {
          to: emp.email,
          subject: `Recuperar contraseña — ${companyName}`,
          html,
        }).catch(() => {})
      }

      return {
        success: true,
        message: 'Si la cédula está registrada con un correo, recibirás instrucciones.',
      }
    },
    {
      body: t.Object({ idNumber: t.String({ minLength: 1 }) }),
    }
  )

  .post(
    '/reset-password',
    async ({ db, body, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }

      const [cred] = await (db as AnyDb)
        .select()
        .from(employeeCredentials)
        .where(eq(employeeCredentials.resetToken, body.token))
        .limit(1)

      if (!cred) {
        set.status = 400
        return { success: false, error: 'Token inválido o expirado.' }
      }

      if (!cred.resetTokenExpiresAt || new Date(cred.resetTokenExpiresAt) < new Date()) {
        set.status = 400
        return { success: false, error: 'El enlace ha expirado. Solicita uno nuevo.' }
      }

      const hash = await hashPassword(body.password)
      await (db as AnyDb)
        .update(employeeCredentials)
        .set({
          passwordHash: hash,
          resetToken: null,
          resetTokenExpiresAt: null,
          failedAttempts: 0,
          isLocked: false,
          passwordChangedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(employeeCredentials.id, cred.id))

      return { success: true, message: 'Contraseña actualizada. Ya puedes iniciar sesión.' }
    },
    {
      body: t.Object({
        token: t.String({ minLength: 1 }),
        password: t.String({ minLength: 6 }),
      }),
    }
  )

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
