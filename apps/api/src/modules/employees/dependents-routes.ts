import { dependents } from '@payroll/db'
import { and, desc, eq } from 'drizzle-orm'
import { Elysia, t } from 'elysia'
import { authPlugin, guardAuth, guardPermission } from '../../middleware/auth'
import { guardTenantMatchesToken, tenantPlugin } from '../../middleware/tenant'

export const dependentsRoutes = new Elysia({ prefix: '/dependents' })
  .use(authPlugin)
  .use(tenantPlugin)

  .get(
    '/:employeeId',
    async ({ db, params, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const data = await db
        .select()
        .from(dependents)
        .where(eq(dependents.employeeId, params.employeeId))
        .orderBy(desc(dependents.createdAt))
      return { success: true, data }
    },
    {
      beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('employees:read')],
      params: t.Object({ employeeId: t.String() }),
    }
  )

  .post(
    '/:employeeId',
    async ({ db, params, body, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const [row] = await db
        .insert(dependents)
        .values({
          employeeId: params.employeeId,
          firstName: body.firstName.trim(),
          lastName: body.lastName.trim(),
          idNumber: body.idNumber?.trim() || null,
          relationship: body.relationship,
          birthDate: body.birthDate || null,
          sex: body.sex || null,
          hasDisability: body.hasDisability ?? false,
          disabilityDescription: body.disabilityDescription?.trim() || null,
        })
        .returning()
      set.status = 201
      return { success: true, data: row }
    },
    {
      beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('employees:update')],
      params: t.Object({ employeeId: t.String() }),
      body: t.Object({
        firstName: t.String({ minLength: 1 }),
        lastName: t.String({ minLength: 1 }),
        idNumber: t.Optional(t.Nullable(t.String())),
        relationship: t.String(),
        birthDate: t.Optional(t.Nullable(t.String())),
        sex: t.Optional(t.Nullable(t.String())),
        hasDisability: t.Optional(t.Boolean()),
        disabilityDescription: t.Optional(t.Nullable(t.String())),
      }),
    }
  )

  .put(
    '/:employeeId/:id',
    async ({ db, params, body, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const [row] = await db
        .update(dependents)
        .set({
          firstName: body.firstName?.trim(),
          lastName: body.lastName?.trim(),
          idNumber: body.idNumber?.trim() || null,
          relationship: body.relationship,
          birthDate: body.birthDate || null,
          sex: body.sex || null,
          hasDisability: body.hasDisability ?? false,
          disabilityDescription: body.disabilityDescription?.trim() || null,
          updatedAt: new Date(),
        })
        .where(and(eq(dependents.id, params.id), eq(dependents.employeeId, params.employeeId)))
        .returning()
      if (!row) {
        set.status = 404
        return { success: false, error: 'Dependiente no encontrado.' }
      }
      return { success: true, data: row }
    },
    {
      beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('employees:update')],
      params: t.Object({ employeeId: t.String(), id: t.String() }),
      body: t.Object({
        firstName: t.Optional(t.String()),
        lastName: t.Optional(t.String()),
        idNumber: t.Optional(t.Nullable(t.String())),
        relationship: t.Optional(t.String()),
        birthDate: t.Optional(t.Nullable(t.String())),
        sex: t.Optional(t.Nullable(t.String())),
        hasDisability: t.Optional(t.Boolean()),
        disabilityDescription: t.Optional(t.Nullable(t.String())),
      }),
    }
  )

  .delete(
    '/:employeeId/:id',
    async ({ db, params, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      await db
        .update(dependents)
        .set({ isActive: false, updatedAt: new Date() })
        .where(and(eq(dependents.id, params.id), eq(dependents.employeeId, params.employeeId)))
      return { success: true }
    },
    {
      beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('employees:update')],
      params: t.Object({ employeeId: t.String(), id: t.String() }),
    }
  )
