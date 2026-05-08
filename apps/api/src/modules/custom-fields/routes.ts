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
import { CUSTOM_FIELD_TYPES, concepts, customFieldDefinitions } from '@payroll/db'
import type { PermissionCode } from '@payroll/types'
import { and, asc, eq } from 'drizzle-orm'
import { Elysia, t } from 'elysia'
import {
  type AuthUser,
  authPlugin,
  guardAuth,
  guardPermission,
  userHasPermissions,
} from '../../middleware/auth'
import { guardTenantMatchesToken, tenantPlugin } from '../../middleware/tenant'

// biome-ignore lint/suspicious/noExplicitAny: Drizzle generic
type AnyDb = any

const FieldType = t.Union(CUSTOM_FIELD_TYPES.map((c) => t.Literal(c)))

const CodePattern = t.String({
  minLength: 1,
  maxLength: 50,
  pattern: '^[a-z][a-z0-9_]*$',
})

const DependencyRule = t.Object({
  field: t.String({ minLength: 1, maxLength: 50 }),
  op: t.Union([
    t.Literal('eq'),
    t.Literal('ne'),
    t.Literal('gt'),
    t.Literal('lt'),
    t.Literal('gte'),
    t.Literal('lte'),
    t.Literal('in'),
    t.Literal('empty'),
    t.Literal('notEmpty'),
  ]),
  value: t.Optional(t.Any()),
  values: t.Optional(t.Array(t.Any())),
  effect: t.Union([t.Literal('required'), t.Literal('visible'), t.Literal('readonly')]),
})

const ValidationRules = t.Optional(
  t.Object({
    minLength: t.Optional(t.Integer({ minimum: 0 })),
    maxLength: t.Optional(t.Integer({ minimum: 1 })),
    min: t.Optional(t.Number()),
    max: t.Optional(t.Number()),
    pattern: t.Optional(t.String({ maxLength: 200 })),
    dependsOn: t.Optional(t.Array(DependencyRule)),
    readPermission: t.Optional(t.Nullable(t.String({ maxLength: 100 }))),
    writePermission: t.Optional(t.Nullable(t.String({ maxLength: 100 }))),
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

/**
 * Read `validationRules.readPermission` con tolerancia a tipos. Devuelve
 * el código de permiso requerido o `null` si el campo está abierto.
 */
export function readReadPermission(rules: unknown): PermissionCode | null {
  if (!rules || typeof rules !== 'object') return null
  const v = (rules as Record<string, unknown>).readPermission
  return typeof v === 'string' && v.length > 0 ? (v as PermissionCode) : null
}

export function readWritePermission(rules: unknown): PermissionCode | null {
  if (!rules || typeof rules !== 'object') return null
  const v = (rules as Record<string, unknown>).writePermission
  return typeof v === 'string' && v.length > 0 ? (v as PermissionCode) : null
}

/**
 * Filtra del listado las definiciones cuya `readPermission` el usuario
 * no posee. Mantiene cualquier definición sin restricción declarada.
 */
function filterByReadPermission<T extends { validationRules?: unknown }>(
  rows: T[],
  user: AuthUser | null
): T[] {
  return rows.filter((row) => {
    const perm = readReadPermission(row.validationRules)
    if (!perm) return true
    return userHasPermissions(user, [perm])
  })
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
    async ({ db, user, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const all = await listAll(db)
      // Si el usuario es admin del catálogo (settings:company.update),
      // entrega todo —  la pantalla de configuración necesita ver
      // los campos restringidos para poder editarlos.
      const data = userHasPermissions(user, ['settings:company.update'])
        ? all
        : filterByReadPermission(all, user)
      return { success: true, data }
    },
    { beforeHandle: [guardAuth, guardTenantMatchesToken] }
  )

  .get(
    '/:id',
    async ({ db, user, params, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const row = await getById(db, params.id)
      if (!row) {
        set.status = 404
        return { success: false, error: 'Custom field not found' }
      }
      const perm = readReadPermission(row.validationRules)
      if (perm && !userHasPermissions(user, [perm])) {
        set.status = 403
        return { success: false, error: 'Forbidden: missing read permission for this field' }
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

  // ── GET /custom-fields/:id/usage ────────────────────────────────────────
  // Devuelve las fórmulas de conceptos que referencian este campo a través
  // de CAMPOADICIONAL("code"). Útil para evitar desactivar un campo que
  // todavía alimenta cálculos.
  .get(
    '/:id/usage',
    async ({ db, params, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const def = await getById(db, params.id)
      if (!def) {
        set.status = 404
        return { success: false, error: 'Custom field not found' }
      }
      // biome-ignore lint/suspicious/noExplicitAny: drizzle generic
      const allConcepts: any[] = await db.select().from(concepts)
      // Comilla simple o doble + el code exacto. Permitimos espacios
      // alrededor del paréntesis y la coma para no perder usos válidos.
      const escaped = def.code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const re = new RegExp(`CAMPOADICIONAL\\s*\\(\\s*["']${escaped}["']\\s*[,)]`, 'i')
      const referencing = allConcepts
        .filter((c) => typeof c.formula === 'string' && re.test(c.formula))
        .map((c) => ({
          id: c.id as string,
          code: c.code as string,
          name: c.name as string,
          type: c.type as string,
          formula: c.formula as string,
          isActive: !!c.isActive,
        }))
      return {
        success: true,
        data: {
          fieldCode: def.code,
          fieldName: def.name,
          referencingConcepts: referencing,
        },
      }
    },
    {
      beforeHandle: [guardAuth, guardTenantMatchesToken],
      params: t.Object({ id: t.String() }),
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
