/**
 * Admin endpoints for managing employee portal credentials.
 *
 *   POST /portal/credentials          — create credentials for an employee
 *   POST /portal/credentials/reset    — reset password
 *   POST /portal/credentials/unlock   — unlock a locked account
 *   GET  /portal/credentials/status   — list employees with/without credentials
 */
import { employeeCredentials, employees, portalAccess, portalAllowedFileTypes } from '@payroll/db'
import { and, eq, sql } from 'drizzle-orm'
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
          mustChangePassword: true,
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

  .get(
    '/access/:employeeId',
    async ({ db, params, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const [cred] = await db
        .select({
          isActive: employeeCredentials.isActive,
          isLocked: employeeCredentials.isLocked,
          isApprover: employeeCredentials.isApprover,
          mustChangePassword: employeeCredentials.mustChangePassword,
          lastLoginAt: employeeCredentials.lastLoginAt,
        })
        .from(employeeCredentials)
        .where(eq(employeeCredentials.employeeId, params.employeeId))
        .limit(1)

      let modules: { module: string; isEnabled: boolean }[] = []
      try {
        modules = await db
          .select({ module: portalAccess.module, isEnabled: portalAccess.isEnabled })
          .from(portalAccess)
          .where(eq(portalAccess.employeeId, params.employeeId))
      } catch {}

      return {
        success: true,
        data: {
          hasCredentials: !!cred,
          credentials: cred ?? null,
          modules,
        },
      }
    },
    {
      beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('users:read')],
      params: t.Object({ employeeId: t.String() }),
    }
  )

  .post(
    '/access/:employeeId',
    async ({ db, params, body, user, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const empId = params.employeeId

      if (body.portalEnabled !== undefined) {
        const [existing] = await db
          .select()
          .from(employeeCredentials)
          .where(eq(employeeCredentials.employeeId, empId))
          .limit(1)

        if (!existing && body.portalEnabled) {
          const { hashPassword: hp } = await import('../../lib/password')
          const hash = await hp('172839')
          await db
            .insert(employeeCredentials)
            .values({ employeeId: empId, passwordHash: hash, mustChangePassword: true })
            .onConflictDoNothing()
        } else if (existing) {
          await db
            .update(employeeCredentials)
            .set({ isActive: body.portalEnabled, updatedAt: new Date() })
            .where(eq(employeeCredentials.employeeId, empId))
        }
      }

      if (body.isApprover !== undefined) {
        await db
          .update(employeeCredentials)
          .set({ isApprover: body.isApprover, updatedAt: new Date() })
          .where(eq(employeeCredentials.employeeId, empId))
      }

      if (body.modules) {
        try {
          for (const m of body.modules) {
            await db
              .insert(portalAccess)
              .values({
                employeeId: empId,
                module: m.module,
                isEnabled: m.isEnabled,
                grantedBy: user?.userId ?? null,
              })
              .onConflictDoUpdate({
                target: [portalAccess.employeeId, portalAccess.module],
                set: {
                  isEnabled: m.isEnabled,
                  grantedBy: user?.userId ?? null,
                  grantedAt: new Date(),
                },
              })
          }
        } catch {}
      }

      return { success: true }
    },
    {
      beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('users:write')],
      params: t.Object({ employeeId: t.String() }),
      body: t.Object({
        portalEnabled: t.Optional(t.Boolean()),
        isApprover: t.Optional(t.Boolean()),
        modules: t.Optional(t.Array(t.Object({ module: t.String(), isEnabled: t.Boolean() }))),
      }),
    }
  )

  .get(
    '/allowed-types/:employeeId',
    async ({ db, params, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      try {
        const rows = await db
          .select()
          .from(portalAllowedFileTypes)
          .where(eq(portalAllowedFileTypes.employeeId, params.employeeId))
        return { success: true, data: rows }
      } catch {
        return { success: true, data: [] }
      }
    },
    {
      beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('users:read')],
      params: t.Object({ employeeId: t.String() }),
    }
  )

  .post(
    '/allowed-types/:employeeId',
    async ({ db, params, body, user, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      try {
        await db
          .delete(portalAllowedFileTypes)
          .where(eq(portalAllowedFileTypes.employeeId, params.employeeId))
        if (body.allowedTypes && body.allowedTypes.length > 0) {
          for (const at of body.allowedTypes) {
            await db
              .insert(portalAllowedFileTypes)
              .values({
                employeeId: params.employeeId,
                typeId: at.typeId,
                subtypeId: at.subtypeId ?? null,
                grantedBy: user?.userId ?? null,
              })
              .onConflictDoNothing()
          }
        }
        return { success: true }
      } catch {
        return { success: true }
      }
    },
    {
      beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('users:write')],
      params: t.Object({ employeeId: t.String() }),
      body: t.Object({
        allowedTypes: t.Array(
          t.Object({ typeId: t.Integer(), subtypeId: t.Optional(t.Nullable(t.Integer())) })
        ),
      }),
    }
  )
