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
import { companyConfig, employeeCredentials, employees, portalAccess, tenants } from '@payroll/db'
import { and, eq, sql } from 'drizzle-orm'
import { Elysia, t } from 'elysia'
import { getTenantDb, publicDb } from '../../config/db'
import { env } from '../../config/env'
import { mailerConfigFromCompany, sendMail } from '../../lib/mailer'
import { hashPassword, verifyPassword } from '../../lib/password'
import { jwtPlugin } from '../../middleware/auth'
import { tenantPlugin } from '../../middleware/tenant'

// biome-ignore lint/suspicious/noExplicitAny: drizzle generic
type AnyDb = any

const MAX_FAILED_ATTEMPTS = 5
const DEFAULT_PASSWORD = '172839'

type EmpRow = {
  id: string
  code: string
  firstName: string
  lastName: string
  idNumber: string
  departmentId: string | null
  isActive: boolean
}

async function findEmployeeAcrossTenants(
  idNumber: string,
  _headerTenant: string | undefined,
  _db: AnyDb
): Promise<{ emp: EmpRow; slug: string } | null> {
  try {
    const activeTenants = await publicDb
      .select({ slug: tenants.slug })
      .from(tenants)
      .where(and(eq(tenants.isActive, true), eq(tenants.status, 'ACTIVE')))

    for (const t of activeTenants) {
      try {
        const tdb = getTenantDb(t.slug)
        const rows: AnyDb[] = await tdb.execute(
          sql`SELECT id, code, first_name, last_name, id_number, department_id, is_active
              FROM employees WHERE id_number = ${idNumber} LIMIT 1`
        )
        if (rows.length > 0) {
          const r = rows[0]
          return {
            emp: {
              id: r.id,
              code: r.code,
              firstName: r.first_name,
              lastName: r.last_name,
              idNumber: r.id_number,
              departmentId: r.department_id ?? null,
              isActive: r.is_active,
            },
            slug: t.slug,
          }
        }
      } catch {}
    }
  } catch (err) {
    console.error('[findEmployee] tenant list query failed:', err)
  }
  return null
}

export const portalAuthRoutes = new Elysia({ prefix: '/portal/auth' })
  .use(jwtPlugin)
  .use(tenantPlugin)

  .post(
    '/login',
    async ({ db, body, jwt, cookie, set, tenantSlug: headerTenant }) => {
      try {
        const idNumber = body.idNumber.trim()
        const password = body.password

        const found = await findEmployeeAcrossTenants(idNumber, headerTenant, db)
        if (!found || !found.emp.isActive) {
          set.status = 401
          return { success: false, error: 'Cédula o contraseña incorrecta.' }
        }

        const { emp, slug: resolvedSlug } = found
        const tdb = getTenantDb(resolvedSlug) as AnyDb

        let credRows: AnyDb[] = await tdb.execute(
          sql`SELECT * FROM employee_credentials WHERE employee_id = ${emp.id} LIMIT 1`
        )
        let cred = credRows[0]

        if (!cred) {
          const defaultHash = await hashPassword(DEFAULT_PASSWORD)
          await tdb.execute(
            sql`INSERT INTO employee_credentials (employee_id, password_hash)
                VALUES (${emp.id}, ${defaultHash})
                ON CONFLICT (employee_id) DO NOTHING`
          )
          credRows = await tdb.execute(
            sql`SELECT * FROM employee_credentials WHERE employee_id = ${emp.id} LIMIT 1`
          )
          cred = credRows[0]
        }

        if (!cred?.is_active) {
          set.status = 401
          return { success: false, error: 'Cuenta desactivada. Contacte a Recursos Humanos.' }
        }

        const failedAttempts = cred.failed_attempts ?? 0
        if (cred.is_locked || failedAttempts >= MAX_FAILED_ATTEMPTS) {
          set.status = 423
          return {
            success: false,
            error: 'Cuenta bloqueada por intentos fallidos. Contacte a Recursos Humanos.',
          }
        }

        const valid = await verifyPassword(password, cred.password_hash)
        if (!valid) {
          await tdb.execute(
            sql`UPDATE employee_credentials
                SET failed_attempts = ${failedAttempts + 1},
                    is_locked = ${failedAttempts + 1 >= MAX_FAILED_ATTEMPTS},
                    updated_at = now()
                WHERE id = ${cred.id}`
          )
          set.status = 401
          return { success: false, error: 'Cédula o contraseña incorrecta.' }
        }

        await tdb.execute(
          sql`UPDATE employee_credentials
              SET failed_attempts = 0, last_login_at = now(), updated_at = now()
              WHERE id = ${cred.id}`
        )

        const mustChange = cred.must_change_password ?? false
        const isApprover = cred.is_approver ?? false

        if (mustChange) {
          const tempToken = await jwt.sign({
            type: 'employee',
            employeeId: emp.id,
            employeeCode: emp.code,
            name: `${emp.firstName} ${emp.lastName}`,
            idNumber: emp.idNumber,
            departmentId: emp.departmentId ?? null,
            isApprover,
            tenantSlug: resolvedSlug,
            mustChangePassword: true,
            exp: Math.floor(Date.now() / 1000) + 900,
          })
          cookie.portal_auth.set({
            value: tempToken,
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            path: '/',
            maxAge: 900,
          })
          return { success: true, mustChangePassword: true }
        }

        let modules: string[] = []
        try {
          const accessRows = await tdb.execute(
            sql`SELECT module FROM portal_access WHERE employee_id = ${emp.id} AND is_enabled = true`
          )
          modules = (accessRows as AnyDb[]).map((r: AnyDb) => r.module)
        } catch {}

        const token = await jwt.sign({
          type: 'employee',
          employeeId: emp.id,
          employeeCode: emp.code,
          name: `${emp.firstName} ${emp.lastName}`,
          idNumber: emp.idNumber,
          departmentId: emp.departmentId ?? null,
          isApprover,
          modules,
          tenantSlug: resolvedSlug,
          exp: Math.floor(Date.now() / 1000) + 8 * 3600,
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
          data: { employeeId: emp.id, code: emp.code, name: `${emp.firstName} ${emp.lastName}` },
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[portal/login] error:', msg, err)
        set.status = 500
        return { success: false, error: `Error interno: ${msg}` }
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
    '/change-password',
    async ({ jwt, cookie, body, set }) => {
      const token = cookie.portal_auth?.value
      if (!token) {
        set.status = 401
        return { success: false, error: 'No autenticado.' }
      }
      const payload = await jwt.verify(token)
      if (!payload || (payload as AnyDb).type !== 'employee') {
        set.status = 401
        return { success: false, error: 'Sesión inválida.' }
      }
      const p = payload as AnyDb
      const tdb = getTenantDb(p.tenantSlug) as AnyDb

      const [cred] = await tdb
        .select()
        .from(employeeCredentials)
        .where(eq(employeeCredentials.employeeId, p.employeeId))
        .limit(1)
      if (!cred) {
        set.status = 404
        return { success: false, error: 'Credenciales no encontradas.' }
      }

      const hash = await hashPassword(body.password)
      await tdb
        .update(employeeCredentials)
        .set({
          passwordHash: hash,
          mustChangePassword: false,
          passwordChangedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(employeeCredentials.id, cred.id))

      const newToken = await jwt.sign({
        type: 'employee',
        employeeId: p.employeeId,
        employeeCode: p.employeeCode,
        name: p.name,
        idNumber: p.idNumber,
        departmentId: p.departmentId ?? null,
        isApprover: cred.isApprover ?? false,
        tenantSlug: p.tenantSlug,
        exp: Math.floor(Date.now() / 1000) + 8 * 3600,
      })
      cookie.portal_auth.set({
        value: newToken,
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 8 * 3600,
      })

      return { success: true, message: 'Contraseña actualizada.' }
    },
    {
      body: t.Object({ password: t.String({ minLength: 6 }) }),
    }
  )

  .post(
    '/forgot-password',
    async ({ db, body, tenantSlug: headerTenant }) => {
      const idNumber = body.idNumber.trim()
      const SAFE_MSG = 'Si la cédula está registrada con un correo, recibirás instrucciones.'

      type EmpInfo = { id: string; email: string | null; firstName: string }
      let emp: EmpInfo | undefined
      let resolvedSlug = ''

      const active = await publicDb
        .select({ slug: tenants.slug })
        .from(tenants)
        .where(and(eq(tenants.isActive, true), eq(tenants.status, 'ACTIVE')))
      for (const t of active) {
        try {
          const tdb = getTenantDb(t.slug)
          const rows: AnyDb[] = await tdb.execute(
            sql`SELECT id, email, first_name FROM employees WHERE id_number = ${idNumber} LIMIT 1`
          )
          if (rows.length > 0) {
            emp = { id: rows[0].id, email: rows[0].email, firstName: rows[0].first_name }
            resolvedSlug = t.slug
            break
          }
        } catch {}
      }

      if (!emp || !emp.email) return { success: true, message: SAFE_MSG }

      const tdb = getTenantDb(resolvedSlug) as AnyDb
      const credRows: AnyDb[] = await tdb.execute(
        sql`SELECT * FROM employee_credentials WHERE employee_id = ${emp.id} LIMIT 1`
      )
      const cred = credRows[0]

      if (!cred || !cred.is_active) return { success: true, message: SAFE_MSG }

      const token = `${crypto.randomUUID()}-${crypto.randomUUID()}`
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000)

      await tdb.execute(
        sql`UPDATE employee_credentials
            SET reset_token = ${token}, reset_token_expires_at = ${expiresAt}, updated_at = now()
            WHERE id = ${cred.id}`
      )

      const companyRows: AnyDb[] = await tdb.execute(sql`SELECT * FROM company_config LIMIT 1`)
      const cc = companyRows[0] ?? null
      const companyForMailer = cc
        ? {
            mailHost: cc.mail_host,
            mailPort: cc.mail_port,
            mailEncryption: cc.mail_encryption,
            mailUsername: cc.mail_username,
            mailPassword: cc.mail_password,
            mailFromAddress: cc.mail_from_address,
            mailFromName: cc.mail_from_name,
            companyName: cc.company_name,
          }
        : null
      const mailer = mailerConfigFromCompany(companyForMailer as AnyDb)
      if (mailer) {
        const resetUrl = `${env.WEB_URL}/portal/reset-password?token=${encodeURIComponent(token)}`
        const companyName = cc?.company_name ?? 'PayrollSoft'
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

      return { success: true, message: SAFE_MSG }
    },
    {
      body: t.Object({ idNumber: t.String({ minLength: 1 }) }),
    }
  )

  .post(
    '/reset-password',
    async ({ db, body, tenantSlug: headerTenant, set }) => {
      let cred: AnyDb | undefined
      let resolvedDb: AnyDb | undefined

      const active = await publicDb
        .select({ slug: tenants.slug })
        .from(tenants)
        .where(and(eq(tenants.isActive, true), eq(tenants.status, 'ACTIVE')))
      for (const t of active) {
        try {
          const tdb = getTenantDb(t.slug)
          const rows: AnyDb[] = await tdb.execute(
            sql`SELECT * FROM employee_credentials WHERE reset_token = ${body.token} LIMIT 1`
          )
          if (rows.length > 0) {
            cred = rows[0]
            resolvedDb = tdb
            break
          }
        } catch {}
      }

      if (!cred || !resolvedDb) {
        set.status = 400
        return { success: false, error: 'Token inválido o expirado.' }
      }

      if (!cred.reset_token_expires_at || new Date(cred.reset_token_expires_at) < new Date()) {
        set.status = 400
        return { success: false, error: 'El enlace ha expirado. Solicita uno nuevo.' }
      }

      const hash = await hashPassword(body.password)
      await resolvedDb.execute(
        sql`UPDATE employee_credentials
            SET password_hash = ${hash}, reset_token = NULL, reset_token_expires_at = NULL,
                failed_attempts = 0, is_locked = false, password_changed_at = now(), updated_at = now()
            WHERE id = ${cred.id}`
      )

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
