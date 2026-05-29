import { Elysia, t } from 'elysia'
import { authPlugin, guardAuth, guardPermission } from '../../middleware/auth'
import { guardTenantMatchesToken, tenantPlugin } from '../../middleware/tenant'
import { createDelegation, endDelegation, listDelegations } from './delegation-service'

const GUARD = [guardAuth, guardTenantMatchesToken, guardPermission('approvals:delegate')]

export const approvalDelegationRoutes = new Elysia({ prefix: '/approvals/delegations' })
  .use(authPlugin)
  .use(tenantPlugin)

  .get(
    '/',
    async ({ db, query, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const data = await listDelegations(db, {
        delegatorUserId: query.delegator || undefined,
        activeOnly: query.activeOnly === 'true',
      })
      return { success: true, data }
    },
    {
      beforeHandle: GUARD,
      query: t.Object({
        delegator: t.Optional(t.String()),
        activeOnly: t.Optional(t.String()),
      }),
    }
  )

  .post(
    '/',
    async ({ db, body, user, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const result = await createDelegation(db, {
        delegatorUserId: body.delegatorUserId,
        delegateUserId: body.delegateUserId,
        validFrom: body.validFrom,
        validTo: body.validTo,
        reason: body.reason,
        createdBy: user?.userId,
      })
      if (!result.success) {
        set.status = 422
        return result
      }
      return { success: true, data: { id: result.id } }
    },
    {
      beforeHandle: GUARD,
      body: t.Object({
        delegatorUserId: t.String(),
        delegateUserId: t.String(),
        validFrom: t.String(),
        validTo: t.String(),
        reason: t.Optional(t.Nullable(t.String())),
      }),
    }
  )

  .post(
    '/:id/end',
    async ({ db, params, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const result = await endDelegation(db, params.id)
      if (!result.success) {
        set.status = 404
        return result
      }
      return { success: true }
    },
    { beforeHandle: GUARD, params: t.Object({ id: t.String() }) }
  )
