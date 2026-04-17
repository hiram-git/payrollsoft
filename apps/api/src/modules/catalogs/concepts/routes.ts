import { Elysia, t } from 'elysia'
import { authPlugin, guardAuth, guardRole } from '../../../middleware/auth'
import { tenantPlugin } from '../../../middleware/tenant'
import {
  activateConceptService,
  createCatalogItemService,
  createConceptService,
  deactivateConceptService,
  deleteCatalogItemService,
  getConceptConfigService,
  getConceptService,
  listConceptsService,
  updateCatalogItemService,
  updateConceptService,
} from './service'

const LinksBody = t.Object({
  payrollTypeIds: t.Optional(t.Array(t.String())),
  frequencyIds: t.Optional(t.Array(t.String())),
  situationIds: t.Optional(t.Array(t.String())),
  accumulatorIds: t.Optional(t.Array(t.String())),
})

const ConceptBody = t.Object({
  code: t.String({ minLength: 1, maxLength: 20 }),
  name: t.String({ minLength: 1, maxLength: 255 }),
  type: t.String({ minLength: 1, maxLength: 20 }),
  formula: t.Optional(t.Nullable(t.String())),
  unit: t.Optional(t.String()),
  printDetails: t.Optional(t.Boolean()),
  prorates: t.Optional(t.Boolean()),
  allowModify: t.Optional(t.Boolean()),
  isReferenceValue: t.Optional(t.Boolean()),
  useAmountCalc: t.Optional(t.Boolean()),
  allowZero: t.Optional(t.Boolean()),
  links: t.Optional(LinksBody),
})

const ConceptUpdateBody = t.Object({
  code: t.Optional(t.String({ minLength: 1, maxLength: 20 })),
  name: t.Optional(t.String({ minLength: 1, maxLength: 255 })),
  type: t.Optional(t.String({ minLength: 1, maxLength: 20 })),
  formula: t.Optional(t.Nullable(t.String())),
  isActive: t.Optional(t.Boolean()),
  unit: t.Optional(t.String()),
  printDetails: t.Optional(t.Boolean()),
  prorates: t.Optional(t.Boolean()),
  allowModify: t.Optional(t.Boolean()),
  isReferenceValue: t.Optional(t.Boolean()),
  useAmountCalc: t.Optional(t.Boolean()),
  allowZero: t.Optional(t.Boolean()),
  links: t.Optional(LinksBody),
})

export const conceptsRoutes = new Elysia({ prefix: '/concepts' })
  .use(authPlugin)
  .use(tenantPlugin)

  // GET /concepts/config — all 4 catalog lists for the form dropdowns
  .get(
    '/config',
    async ({ db, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const data = await getConceptConfigService(db)
      return { success: true, data }
    },
    { beforeHandle: [guardAuth, guardRole('VIEWER')] }
  )

  .get(
    '/',
    async ({ db, query, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const data = await listConceptsService(db, query.search)
      return { success: true, data }
    },
    {
      beforeHandle: [guardAuth, guardRole('VIEWER')],
      query: t.Object({ search: t.Optional(t.String()) }),
    }
  )

  .get(
    '/:id',
    async ({ db, params, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const row = await getConceptService(db, params.id)
      if (!row) {
        set.status = 404
        return { success: false, error: 'Concept not found' }
      }
      return { success: true, data: row }
    },
    { beforeHandle: [guardAuth, guardRole('VIEWER')], params: t.Object({ id: t.String() }) }
  )

  .post(
    '/',
    async ({ db, body, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const result = await createConceptService(db, {
        ...body,
        links: body.links
          ? {
              payrollTypeIds: body.links.payrollTypeIds ?? [],
              frequencyIds: body.links.frequencyIds ?? [],
              situationIds: body.links.situationIds ?? [],
              accumulatorIds: body.links.accumulatorIds ?? [],
            }
          : undefined,
      })
      if (!result.success) {
        set.status = result.error === 'code_taken' ? 409 : 400
        return { success: false, error: result.message }
      }
      set.status = 201
      return { success: true, data: result.data }
    },
    { beforeHandle: [guardAuth, guardRole('HR')], body: ConceptBody }
  )

  .put(
    '/:id',
    async ({ db, params, body, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const result = await updateConceptService(db, params.id, {
        ...body,
        links: body.links
          ? {
              payrollTypeIds: body.links.payrollTypeIds ?? [],
              frequencyIds: body.links.frequencyIds ?? [],
              situationIds: body.links.situationIds ?? [],
              accumulatorIds: body.links.accumulatorIds ?? [],
            }
          : undefined,
      })
      if (!result.success) {
        set.status = result.error === 'not_found' ? 404 : 409
        return { success: false, error: result.message }
      }
      return { success: true, data: result.data }
    },
    {
      beforeHandle: [guardAuth, guardRole('HR')],
      params: t.Object({ id: t.String() }),
      body: ConceptUpdateBody,
    }
  )

  .delete(
    '/:id',
    async ({ db, params, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const result = await deactivateConceptService(db, params.id)
      if (!result.success) {
        set.status = result.error === 'not_found' ? 404 : 400
        return { success: false, error: result.message }
      }
      return { success: true, data: result.data }
    },
    { beforeHandle: [guardAuth, guardRole('ADMIN')], params: t.Object({ id: t.String() }) }
  )

  // ─── Concept Catalog CRUD ──────────────────────────────────────────────────
  // Reusable for all 4 catalog kinds: payroll-types, frequencies, situations, accumulators

  .post(
    '/config/:kind',
    async ({ db, params, body, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const validKinds = ['payrollType', 'frequency', 'situation', 'accumulator'] as const
      type Kind = (typeof validKinds)[number]
      const kindMap: Record<string, Kind> = {
        'payroll-types': 'payrollType',
        frequencies: 'frequency',
        situations: 'situation',
        accumulators: 'accumulator',
      }
      const kind = kindMap[params.kind]
      if (!kind) {
        set.status = 400
        return { success: false, error: 'Invalid catalog kind' }
      }
      const result = await createCatalogItemService(db, kind, body)
      if (!result.success) {
        set.status = result.error === 'code_taken' ? 409 : 400
        return { success: false, error: result.message }
      }
      set.status = 201
      return { success: true, data: result.data }
    },
    {
      beforeHandle: [guardAuth, guardRole('ADMIN')],
      params: t.Object({ kind: t.String() }),
      body: t.Object({
        code: t.String({ minLength: 1, maxLength: 50 }),
        name: t.String({ minLength: 1, maxLength: 100 }),
        sortOrder: t.Optional(t.Number()),
      }),
    }
  )

  .put(
    '/config/:kind/:id',
    async ({ db, params, body, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      type Kind = 'payrollType' | 'frequency' | 'situation' | 'accumulator'
      const kindMap: Record<string, Kind> = {
        'payroll-types': 'payrollType',
        frequencies: 'frequency',
        situations: 'situation',
        accumulators: 'accumulator',
      }
      const kind = kindMap[params.kind]
      if (!kind) {
        set.status = 400
        return { success: false, error: 'Invalid catalog kind' }
      }
      const result = await updateCatalogItemService(db, kind, params.id, body)
      if (!result.success) {
        set.status = result.error === 'not_found' ? 404 : 400
        return { success: false, error: result.message }
      }
      return { success: true, data: result.data }
    },
    {
      beforeHandle: [guardAuth, guardRole('ADMIN')],
      params: t.Object({ kind: t.String(), id: t.String() }),
      body: t.Object({
        name: t.Optional(t.String({ minLength: 1, maxLength: 100 })),
        sortOrder: t.Optional(t.Number()),
      }),
    }
  )

  .delete(
    '/config/:kind/:id',
    async ({ db, params, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      type Kind = 'payrollType' | 'frequency' | 'situation' | 'accumulator'
      const kindMap: Record<string, Kind> = {
        'payroll-types': 'payrollType',
        frequencies: 'frequency',
        situations: 'situation',
        accumulators: 'accumulator',
      }
      const kind = kindMap[params.kind]
      if (!kind) {
        set.status = 400
        return { success: false, error: 'Invalid catalog kind' }
      }
      const result = await deleteCatalogItemService(db, kind, params.id)
      if (!result.success) {
        set.status = result.error === 'not_found' ? 404 : result.error === 'has_links' ? 409 : 400
        return { success: false, error: result.message }
      }
      return { success: true, data: result.data }
    },
    {
      beforeHandle: [guardAuth, guardRole('ADMIN')],
      params: t.Object({ kind: t.String(), id: t.String() }),
    }
  )

  .post(
    '/:id/activate',
    async ({ db, params, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const result = await activateConceptService(db, params.id)
      if (!result.success) {
        set.status = result.error === 'not_found' ? 404 : 400
        return { success: false, error: result.message }
      }
      return { success: true, data: result.data }
    },
    { beforeHandle: [guardAuth, guardRole('ADMIN')], params: t.Object({ id: t.String() }) }
  )
