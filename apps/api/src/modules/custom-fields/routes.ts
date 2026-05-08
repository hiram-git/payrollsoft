/**
 * Catálogo de campos adicionales (custom fields) por tenant.
 *
 * CRUD del catálogo de definiciones que la UI usa para renderizar el
 * formulario extendido del empleado. Los valores por empleado siguen
 * viviendo en `employees.custom_fields` (jsonb) — esta tabla solo
 * cataloga los campos disponibles y sus tipos.
 *
 * Endpoints:
 *   GET    /custom-fields              listar todas las definiciones
 *   GET    /custom-fields/:id          detalle
 *   POST   /custom-fields              crear (admin)
 *   PUT    /custom-fields/:id          actualizar (admin)
 *   DELETE /custom-fields/:id          desactivar (soft delete)
 *
 * Permisos:
 *   - read   → cualquier autenticado del tenant
 *   - write  → settings:company.update
 */
import { CUSTOM_FIELD_TYPES, customFieldDefinitions } from '@payroll/db'
import { and, asc, eq } from 'drizzle-orm'
import { Elysia, t } from 'elysia'
import { authPlugin, guardAuth, guardPermission } from '../../middleware/auth'
import { guardTenantMatchesToken, tenantPlugin } from '../../middleware/tenant'

// biome-ignore lint/suspicious/noExplicitAny: Drizzle generic
type AnyDb = any

const FieldType = t.Union(CUSTOM_FIELD_TYPES.map((c) => t.Literal(c)))

const CodePattern = t.String({
  minLength: 1,
  maxLength: 50,
  pattern: '^[a-z][a-z0-9_]*$',
})

const ValidationRules = t.Optional(
  t.Object({
    minLength: t.Optional(t.Integer({ minimum: 0 })),
    maxLength: t.Optional(t.Integer({ minimum: 1 })),
    min: t.Optional(t.Number()),
    max: t.Optional(t.Number()),
    pattern: t.Optional(t.String({ maxLength: 200 })),
  })
)

const CreateBody = t.Object({
  code: CodePattern,
  name: t.String({ minLength: 1, maxLength: 255 }),
  description: t.Optional(t.Nullable(t.String({ maxLength: 2000 }))),
  fieldType: FieldType,
  isRequired: t.Optional(t.Boolean()),
  defaultValue: t.Optional(t.Nullable(t.Any())),
  validationRules: ValidationRules,
  sortOrder: t.Optional(t.Integer({ minimum: 0, maximum: 9999 })),
  isActive: t.Optional(t.Boolean()),
})

const UpdateBody = t.Object({
  name: t.Optional(t.String({ minLength: 1, maxLength: 255 })),
  description: t.Optional(t.Nullable(t.String({ maxLength: 2000 }))),
  fieldType: t.Optional(FieldType),
  isRequired: t.Optional(t.Boolean()),
  defaultValue: t.Optional(t.Nullable(t.Any())),
  validationRules: ValidationRules,
  sortOrder: t.Optional(t.Integer({ minimum: 0, maximum: 9999 })),
  isActive: t.Optional(t.Boolean()),
})

async function listAll(db: AnyDb) {
  return db
    .select()
    .from(customFieldDefinitions)
    .orderBy(asc(customFieldDefinitions.sortOrder), asc(customFieldDefinitions.name))
}

async function getById(db: AnyDb, id: string) {
  const rows = await db
    .select()
    .from(customFieldDefinitions)
    .where(eq(customFieldDefinitions.id, id))
    .limit(1)
  return rows[0] ?? null
}

async function getByCode(db: AnyDb, code: string) {
  const rows = await db
    .select()
    .from(customFieldDefinitions)
    .where(eq(customFieldDefinitions.code, code))
    .limit(1)
  return rows[0] ?? null
}

export const customFieldsRoutes = new Elysia({ prefix: '/custom-fields' })
  .use(authPlugin)
  .use(tenantPlugin)

  .get(
    '/',
    async ({ db, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const data = await listAll(db)
      return { success: true, data }
    },
    { beforeHandle: [guardAuth, guardTenantMatchesToken] }
  )

  .get(
    '/:id',
    async ({ db, params, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const row = await getById(db, params.id)
      if (!row) {
        set.status = 404
        return { success: false, error: 'Custom field not found' }
      }
      return { success: true, data: row }
    },
    {
      beforeHandle: [guardAuth, guardTenantMatchesToken],
      params: t.Object({ id: t.String() }),
    }
  )

  .post(
    '/',
    async ({ db, body, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const existing = await getByCode(db, body.code)
      if (existing) {
        set.status = 409
        return {
          success: false,
          error: 'code_taken',
          message: `Ya existe un campo con el código "${body.code}".`,
        }
      }
      const [row] = await db
        .insert(customFieldDefinitions)
        .values({
          code: body.code,
          name: body.name.trim(),
          description: body.description ?? null,
          fieldType: body.fieldType,
          isRequired: body.isRequired ?? false,
          defaultValue: body.defaultValue ?? null,
          validationRules: body.validationRules ?? {},
          sortOrder: body.sortOrder ?? 0,
          isActive: body.isActive ?? true,
        })
        .returning()
      set.status = 201
      return { success: true, data: row }
    },
    {
      beforeHandle: [
        guardAuth,
        guardTenantMatchesToken,
        guardPermission('settings:company.update'),
      ],
      body: CreateBody,
    }
  )

  .put(
    '/:id',
    async ({ db, params, body, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const existing = await getById(db, params.id)
      if (!existing) {
        set.status = 404
        return { success: false, error: 'Custom field not found' }
      }
      const patch: Record<string, unknown> = { updatedAt: new Date() }
      if (body.name !== undefined) patch.name = body.name.trim()
      if (body.description !== undefined) patch.description = body.description ?? null
      if (body.fieldType !== undefined) patch.fieldType = body.fieldType
      if (body.isRequired !== undefined) patch.isRequired = body.isRequired
      if (body.defaultValue !== undefined) patch.defaultValue = body.defaultValue ?? null
      if (body.validationRules !== undefined) patch.validationRules = body.validationRules ?? {}
      if (body.sortOrder !== undefined) patch.sortOrder = body.sortOrder
      if (body.isActive !== undefined) patch.isActive = body.isActive
      const [row] = await db
        .update(customFieldDefinitions)
        .set(patch)
        .where(eq(customFieldDefinitions.id, params.id))
        .returning()
      return { success: true, data: row }
    },
    {
      beforeHandle: [
        guardAuth,
        guardTenantMatchesToken,
        guardPermission('settings:company.update'),
      ],
      params: t.Object({ id: t.String() }),
      body: UpdateBody,
    }
  )

  .delete(
    '/:id',
    async ({ db, params, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const existing = await getById(db, params.id)
      if (!existing) {
        set.status = 404
        return { success: false, error: 'Custom field not found' }
      }
      // Soft delete: marca isActive=false. Los valores existentes en
      // employees.custom_fields se conservan para no perder histórico.
      const [row] = await db
        .update(customFieldDefinitions)
        .set({ isActive: false, updatedAt: new Date() })
        .where(and(eq(customFieldDefinitions.id, params.id)))
        .returning()
      return { success: true, data: row }
    },
    {
      beforeHandle: [
        guardAuth,
        guardTenantMatchesToken,
        guardPermission('settings:company.update'),
      ],
      params: t.Object({ id: t.String() }),
    }
  )
