/**
 * Admin endpoints for managing employee portal credentials.
 *
 *   POST /portal/credentials          — create credentials for an employee
 *   POST /portal/credentials/reset    — reset password
 *   POST /portal/credentials/unlock   — unlock a locked account
 *   GET  /portal/credentials/status   — list employees with/without credentials
 */
import { employeeCredentials, employees } from '@payroll/db'
import { eq, sql } from 'drizzle-orm'
import { Elysia, t } from 'elysia'
import { hashPassword } from '../../lib/password'
import { authPlugin, guardAuth, guardPermission } from '../../middleware/auth'
import { guardTenantMatchesToken, tenantPlugin } from '../../middleware/tenant'

export const portalCredentialsRoutes = new Elysia({ prefix: '/portal/credentials' })
  .use(authPlugin)
  .use(tenantPlugin)

  .post(
    '/',
    async ({ db, body, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const hash = await hashPassword(body.password)
      try {
        await db
          .insert(employeeCredentials)
          .values({
            employeeId: body.employeeId,
            passwordHash: hash,
          })
          .onConflictDoNothing()
        return { success: true }
      } catch (err) {
        set.status = 422
        return {
          success: false,
          error: err instanceof Error ? err.message : 'Error al crear credenciales.',
        }
      }
    },
    {
      beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('users:write')],
      body: t.Object({
        employeeId: t.String(),
        password: t.String({ minLength: 6 }),
      }),
    }
  )

  .post(
    '/reset',
    async ({ db, body, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const hash = await hashPassword(body.password)
      const res = await db
        .update(employeeCredentials)
        .set({
          passwordHash: hash,
          failedAttempts: 0,
          isLocked: false,
          passwordChangedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(employeeCredentials.employeeId, body.employeeId))
        .returning()
      if (res.length === 0) {
        set.status = 404
        return { success: false, error: 'Credenciales no encontradas para este empleado.' }
      }
      return { success: true }
    },
    {
      beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('users:write')],
      body: t.Object({
        employeeId: t.String(),
        password: t.String({ minLength: 6 }),
      }),
    }
  )

  .post(
    '/unlock',
    async ({ db, body, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      await db
        .update(employeeCredentials)
        .set({ isLocked: false, failedAttempts: 0, updatedAt: new Date() })
        .where(eq(employeeCredentials.employeeId, body.employeeId))
      return { success: true }
    },
    {
      beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('users:write')],
      body: t.Object({ employeeId: t.String() }),
    }
  )

  .post(
    '/toggle-approver',
    async ({ db, body, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      await db
        .update(employeeCredentials)
        .set({ isApprover: body.isApprover, updatedAt: new Date() })
        .where(eq(employeeCredentials.employeeId, body.employeeId))
      return { success: true }
    },
    {
      beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('users:write')],
      body: t.Object({ employeeId: t.String(), isApprover: t.Boolean() }),
    }
  )

  .get(
    '/status',
    async ({ db, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const rows = await db.execute(sql`
        SELECT e.id, e.code, e.first_name, e.last_name, e.id_number,
               ec.id IS NOT NULL AS has_credentials,
               ec.is_active AS cred_active,
               ec.is_locked AS cred_locked,
               ec.is_approver AS is_approver,
               ec.last_login_at
        FROM employees e
        LEFT JOIN employee_credentials ec ON ec.employee_id = e.id
        WHERE e.is_active = true
        ORDER BY e.last_name, e.first_name
      `)
      return { success: true, data: rows }
    },
    {
      beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('users:read')],
    }
  )
