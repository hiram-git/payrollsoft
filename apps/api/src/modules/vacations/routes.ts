/**
 * Rutas del módulo de vacaciones.
 *
 *   GET    /vacations/balance/:employeeId         saldo (refresca accrual)
 *   GET    /vacations/movements/:employeeId       historial de movimientos
 *   GET    /vacations?employeeId=…                solicitudes por empleado
 *   GET    /vacations/:id                         detalle
 *   POST   /vacations                             crear solicitud
 *   POST   /vacations/:id/cancel                  cancelar (solo pendientes)
 *
 *   GET    /vacations/approvals/pending           bandeja del aprobador
 *   POST   /vacations/:id/approve                 aprobar
 *   POST   /vacations/:id/reject                  rechazar (con razón)
 *
 *   GET    /vacations/approval-rules              listar reglas
 *   POST   /vacations/approval-rules              crear regla
 *   DELETE /vacations/approval-rules/:id          desactivar
 *
 *   POST   /vacations/adjust                      ajuste manual (tenant_admin)
 */
import { Elysia, t } from 'elysia'
import { authPlugin, guardAuth, guardPermission } from '../../middleware/auth'
import { guardTenantMatchesToken, tenantPlugin } from '../../middleware/tenant'
import {
  adjustBalance,
  approveRequest,
  cancelRequest,
  createApprovalRule,
  createRequest,
  deactivateApprovalRule,
  getBalance,
  getRequest,
  listApprovalRules,
  listByEmployee,
  listMovements,
  listPendingApprovals,
  rejectRequest,
} from './service'

export const vacationsRoutes = new Elysia({ prefix: '/vacations' })
  .use(authPlugin)
  .use(tenantPlugin)

  // ── Saldo del empleado ─────────────────────────────────────────────────
  .get(
    '/balance/:employeeId',
    async ({ db, params, user, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      try {
        const data = await getBalance(db, params.employeeId, {
          performedBy: user?.userId ?? null,
        })
        return { success: true, data }
      } catch (err) {
        set.status = 500
        return {
          success: false,
          error: err instanceof Error ? err.message : 'Error al consultar saldo',
        }
      }
    },
    {
      beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('vacations:read')],
      params: t.Object({ employeeId: t.String() }),
    }
  )

  // ── Historial de movimientos ───────────────────────────────────────────
  .get(
    '/movements/:employeeId',
    async ({ db, params, query, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const limit = query.limit ? Math.max(1, Math.min(500, Number.parseInt(query.limit, 10))) : 100
      const data = await listMovements(db, params.employeeId, limit)
      return { success: true, data }
    },
    {
      beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('vacations:read')],
      params: t.Object({ employeeId: t.String() }),
      query: t.Object({ limit: t.Optional(t.String()) }),
    }
  )

  // ── Listar solicitudes por empleado ────────────────────────────────────
  .get(
    '/',
    async ({ db, query, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const employeeId = (query.employeeId ?? '').trim()
      if (!employeeId) {
        set.status = 400
        return { success: false, error: 'employeeId es obligatorio' }
      }
      const data = await listByEmployee(db, employeeId)
      return { success: true, data }
    },
    {
      beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('vacations:read')],
      query: t.Object({ employeeId: t.Optional(t.String()) }),
    }
  )

  // ── Detalle ────────────────────────────────────────────────────────────
  .get(
    '/:id',
    async ({ db, params, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const row = await getRequest(db, params.id)
      if (!row) {
        set.status = 404
        return { success: false, error: 'Solicitud no encontrada' }
      }
      return { success: true, data: row }
    },
    {
      beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('vacations:read')],
      params: t.Object({ id: t.String() }),
    }
  )

  // ── Crear solicitud ────────────────────────────────────────────────────
  .post(
    '/',
    async ({ db, body, user, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const result = await createRequest(
        db,
        {
          employeeId: body.employeeId,
          requestType: body.requestType,
          startDate: body.startDate ?? null,
          endDate: body.endDate ?? null,
          enjoyDays: body.enjoyDays ?? 0,
          paidDays: body.paidDays ?? 0,
          reason: body.reason ?? null,
        },
        { requestedBy: user?.userId ?? null }
      )
      if (!result.success) {
        set.status = 422
        return { success: false, error: result.error }
      }
      set.status = 201
      return { success: true, data: result.data }
    },
    {
      beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('vacations:create')],
      body: t.Object({
        employeeId: t.String(),
        requestType: t.Union([t.Literal('enjoy'), t.Literal('pay'), t.Literal('mixed')]),
        startDate: t.Optional(t.Nullable(t.String())),
        endDate: t.Optional(t.Nullable(t.String())),
        enjoyDays: t.Optional(t.Integer({ minimum: 0, maximum: 365 })),
        paidDays: t.Optional(t.Integer({ minimum: 0, maximum: 365 })),
        reason: t.Optional(t.Nullable(t.String({ maxLength: 1000 }))),
      }),
    }
  )

  // ── Cancelar (solo pendientes, por el solicitante o admin) ──────────────
  .post(
    '/:id/cancel',
    async ({ db, params, user, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const result = await cancelRequest(db, params.id, user?.userId ?? '')
      if (!result.success) {
        set.status = 422
        return { success: false, error: result.error }
      }
      return { success: true }
    },
    {
      beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('vacations:create')],
      params: t.Object({ id: t.String() }),
    }
  )

  // ── Workflow ───────────────────────────────────────────────────────────
  .get(
    '/approvals/pending',
    async ({ db, user, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const roles: string[] = []
      if (user?.role) roles.push(String(user.role))
      const data = await listPendingApprovals(db, roles)
      return { success: true, data }
    },
    {
      beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('vacations:approve')],
    }
  )

  .post(
    '/:id/approve',
    async ({ db, params, user, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      try {
        const result = await approveRequest(db, params.id, user?.userId ?? '')
        if (!result.success) {
          set.status = 422
          return { success: false, error: result.error }
        }
        // `payrollId` viene poblado si la solicitud incluía paid_days > 0
        // y la planilla de vacaciones se generó como parte de la aprobación.
        return { success: true, data: result.data }
      } catch (err) {
        set.status = 500
        return {
          success: false,
          error: err instanceof Error ? err.message : 'Error al aprobar la solicitud',
        }
      }
    },
    {
      beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('vacations:approve')],
      params: t.Object({ id: t.String() }),
    }
  )

  .post(
    '/:id/reject',
    async ({ db, params, body, user, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const result = await rejectRequest(db, params.id, user?.userId ?? '', body.reason ?? '')
      if (!result.success) {
        set.status = 422
        return { success: false, error: result.error }
      }
      return { success: true }
    },
    {
      beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('vacations:approve')],
      params: t.Object({ id: t.String() }),
      body: t.Object({ reason: t.Optional(t.String({ maxLength: 1000 })) }),
    }
  )

  // ── Reglas de aprobación ───────────────────────────────────────────────
  .get(
    '/approval-rules',
    async ({ db, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const data = await listApprovalRules(db)
      return { success: true, data }
    },
    {
      beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('vacations:approve')],
    }
  )

  .post(
    '/approval-rules',
    async ({ db, body, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const result = await createApprovalRule(db, {
        requestType: body.requestType ?? null,
        departmentId: body.departmentId ?? null,
        approverRole: body.approverRole,
      })
      set.status = 201
      return { success: true, data: result }
    },
    {
      beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('vacations:approve')],
      body: t.Object({
        requestType: t.Optional(
          t.Nullable(t.Union([t.Literal('enjoy'), t.Literal('pay'), t.Literal('mixed')]))
        ),
        departmentId: t.Optional(t.Nullable(t.String())),
        approverRole: t.String({ minLength: 1, maxLength: 50 }),
      }),
    }
  )

  .delete(
    '/approval-rules/:id',
    async ({ db, params, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const ok = await deactivateApprovalRule(db, params.id)
      if (!ok) {
        set.status = 404
        return { success: false, error: 'Regla no encontrada' }
      }
      return { success: true }
    },
    {
      beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('vacations:approve')],
      params: t.Object({ id: t.String() }),
    }
  )

  // ── Ajustes manuales de saldo ──────────────────────────────────────────
  .post(
    '/adjust',
    async ({ db, body, user, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const result = await adjustBalance(db, {
        employeeId: body.employeeId,
        pool: body.pool,
        days: body.days,
        notes: body.notes,
        performedBy: user?.userId ?? '',
      })
      if (!result.success) {
        set.status = 422
        return { success: false, error: result.error }
      }
      return { success: true }
    },
    {
      beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('vacations:approve')],
      body: t.Object({
        employeeId: t.String(),
        pool: t.Union([t.Literal('enjoy'), t.Literal('paid')]),
        days: t.Integer({ minimum: -365, maximum: 365 }),
        notes: t.String({ minLength: 1, maxLength: 500 }),
      }),
    }
  )
