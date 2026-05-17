/**
 * Rutas del módulo de expedientes de empleados.
 *
 *   GET    /employee-files/types
 *   GET    /employee-files/types/:typeId/subtypes
 *   GET    /employee-files/fields?typeId=&subtypeId=
 *   GET    /employee-files/next-number?typeId=&subtypeId=&documentDate=
 *
 *   GET    /employee-files?employeeId=…              — lista por empleado
 *   GET    /employee-files/:id                       — detalle con adjuntos
 *   POST   /employee-files                           — crear (multipart/form-data)
 *   PUT    /employee-files/:id                       — editar  (multipart/form-data)
 *   DELETE /employee-files/:id                       — eliminar + borra adjuntos
 *
 *   GET    /employee-files/attachments/:id/download  — descarga archivo
 *   GET    /employee-files/attachments/:id/preview   — inline (PDF/img)
 *   DELETE /employee-files/attachments/:id           — borra un adjunto individual
 */
import { Elysia, t } from 'elysia'
import { authPlugin, guardAuth, guardPermission } from '../../middleware/auth'
import { guardTenantMatchesToken, tenantPlugin } from '../../middleware/tenant'
import { getFieldsFor } from './dynamic-fields'
import {
  type EmployeeFileInput,
  type FormFile,
  approveEmployeeFile,
  createSubtype,
  createType,
  createWithCorrelative,
  deactivateApprovalRule,
  deleteAttachmentById,
  deleteEmployeeFile,
  getAttachmentById,
  getById,
  getSubtypes,
  getTypes,
  listAllSubtypes,
  listAllTypes,
  listApprovalRules,
  listByEmployee,
  listPendingApprovals,
  previewNextNumber,
  rejectEmployeeFile,
  updateExisting,
  updateSubtype,
  updateType,
  upsertApprovalRule,
} from './service'
import { readAttachment } from './storage'

/**
 * Lee un multipart/form-data y separa los campos en:
 *   - escalares (strings simples)
 *   - extra fields (cualquier `extra_<name>` se mapea a extraFields[name])
 *   - adjuntos genéricos (`attachments` repetidos → label='adjunto')
 *   - adjuntos por campo (`file_<fieldName>` → label=fieldName)
 *
 * Convenciones:
 *   typeId, subtypeId, documentDate, observations son strings normales.
 *   Los campos del config dinámico viajan con prefijo `extra_`.
 *   Los archivos del config dinámico viajan con prefijo `file_`.
 *   Los archivos genéricos viajan en el campo `attachments` (puede haber varios).
 */
async function parseFormData(req: Request): Promise<{
  scalars: Record<string, string>
  extraFields: Record<string, unknown>
  files: FormFile[]
}> {
  const form = await req.formData()
  const scalars: Record<string, string> = {}
  const extraFields: Record<string, unknown> = {}
  const files: FormFile[] = []

  for (const [key, value] of form.entries()) {
    if (value instanceof File) {
      // Inputs `type="file"` sin archivo elegido igual viajan en el
      // multipart como `File` con `size=0` y `name=""`. Los ignoramos
      // para que no se conviertan en adjuntos vacíos.
      if (value.size === 0 || !value.name) continue
      const bytes = new Uint8Array(await value.arrayBuffer())
      if (key === 'attachments') {
        files.push({
          label: 'adjunto',
          originalName: value.name,
          mimeType: value.type || 'application/octet-stream',
          bytes,
        })
      } else if (key.startsWith('file_')) {
        files.push({
          label: key.slice('file_'.length),
          originalName: value.name,
          mimeType: value.type || 'application/octet-stream',
          bytes,
        })
      }
      continue
    }
    // value es string
    if (key.startsWith('extra_')) {
      extraFields[key.slice('extra_'.length)] = value
    } else {
      scalars[key] = value
    }
  }
  return { scalars, extraFields, files }
}

function intOrNull(v: string | undefined): number | null {
  if (v == null || v === '') return null
  const n = Number.parseInt(String(v), 10)
  return Number.isFinite(n) ? n : null
}

export const employeeFilesRoutes = new Elysia({ prefix: '/employee-files' })
  .use(authPlugin)
  .use(tenantPlugin)

  // ── Catálogo ───────────────────────────────────────────────────────────
  .get(
    '/types',
    async ({ db, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const data = await getTypes(db)
      return { success: true, data }
    },
    { beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('employee_files:read')] }
  )

  .get(
    '/types/:typeId/subtypes',
    async ({ db, params, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const typeId = Number.parseInt(params.typeId, 10)
      if (!Number.isFinite(typeId)) {
        set.status = 400
        return { success: false, error: 'typeId inválido' }
      }
      const data = await getSubtypes(db, typeId)
      return { success: true, data }
    },
    {
      beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('employee_files:read')],
      params: t.Object({ typeId: t.String() }),
    }
  )

  .get(
    '/fields',
    async ({ db, query, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const typeId = intOrNull(query.typeId)
      const subtypeId = intOrNull(query.subtypeId)
      if (!typeId || !subtypeId) {
        set.status = 400
        return { success: false, error: 'typeId y subtypeId son obligatorios' }
      }
      // resolver codes para mapear a la config
      const types = await getTypes(db)
      const t = types.find((x: { id: number }) => x.id === typeId)
      if (!t) {
        set.status = 404
        return { success: false, error: 'Tipo no encontrado' }
      }
      const subs = await getSubtypes(db, typeId)
      const s = subs.find((x: { id: number }) => x.id === subtypeId)
      if (!s) {
        set.status = 404
        return { success: false, error: 'Subtipo no encontrado' }
      }
      return {
        success: true,
        data: { typeCode: t.code, subtypeCode: s.code, fields: getFieldsFor(t.code, s.code) },
      }
    },
    {
      beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('employee_files:read')],
      query: t.Object({
        typeId: t.Optional(t.String()),
        subtypeId: t.Optional(t.String()),
      }),
    }
  )

  .get(
    '/next-number',
    async ({ db, query, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const typeId = intOrNull(query.typeId)
      const subtypeId = intOrNull(query.subtypeId)
      const date = (query.documentDate ?? '').trim()
      if (!typeId || !subtypeId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        set.status = 400
        return {
          success: false,
          error: 'typeId, subtypeId y documentDate (YYYY-MM-DD) son obligatorios',
        }
      }
      const documentNumber = await previewNextNumber(db, typeId, subtypeId, date)
      return { success: true, data: { documentNumber } }
    },
    {
      beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('employee_files:read')],
      query: t.Object({
        typeId: t.Optional(t.String()),
        subtypeId: t.Optional(t.String()),
        documentDate: t.Optional(t.String()),
      }),
    }
  )

  // ── Listado / detalle ──────────────────────────────────────────────────
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
      beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('employee_files:read')],
      query: t.Object({ employeeId: t.Optional(t.String()) }),
    }
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
        return { success: false, error: 'Expediente no encontrado' }
      }
      return { success: true, data: row }
    },
    {
      beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('employee_files:read')],
      params: t.Object({ id: t.String() }),
    }
  )

  // ── Crear (multipart) ──────────────────────────────────────────────────
  .post(
    '/',
    async ({ db, request, tenantSlug, user, set }) => {
      if (!db || !tenantSlug) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      let parsed: Awaited<ReturnType<typeof parseFormData>>
      try {
        parsed = await parseFormData(request)
      } catch {
        set.status = 400
        return { success: false, error: 'No se pudo leer el formulario multipart.' }
      }
      const input: EmployeeFileInput = {
        employeeId: (parsed.scalars.employeeId ?? '').trim(),
        typeId: intOrNull(parsed.scalars.typeId) ?? 0,
        subtypeId: intOrNull(parsed.scalars.subtypeId) ?? 0,
        documentDate: (parsed.scalars.documentDate ?? '').trim(),
        observations: parsed.scalars.observations ?? null,
        extraFields: parsed.extraFields,
      }
      if (!input.employeeId || !input.typeId || !input.subtypeId || !input.documentDate) {
        set.status = 400
        return {
          success: false,
          error: 'employeeId, typeId, subtypeId y documentDate son obligatorios',
        }
      }
      try {
        const result = await createWithCorrelative(db, tenantSlug, input, parsed.files, {
          createdBy: user?.userId ?? null,
        })
        if (!result.success) {
          set.status = result.error === 'validation' ? 422 : 400
          return { success: false, error: result.message }
        }
        set.status = 201
        return { success: true, data: result.data }
      } catch (err) {
        // El service hace I/O a disco + transacciones; cualquier crash
        // imprevisto (volumen lleno, FK rota, etc) se devuelve con un
        // mensaje legible en lugar de un 500 silencioso.
        console.error('[employee-files] create failed:', err)
        set.status = 500
        return {
          success: false,
          error: err instanceof Error ? err.message : 'Error interno al guardar el expediente.',
        }
      }
    },
    {
      beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('employee_files:write')],
    }
  )

  // ── Editar ─────────────────────────────────────────────────────────────
  .put(
    '/:id',
    async ({ db, request, params, tenantSlug, user, set }) => {
      if (!db || !tenantSlug) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      let parsed: Awaited<ReturnType<typeof parseFormData>>
      try {
        parsed = await parseFormData(request)
      } catch {
        set.status = 400
        return { success: false, error: 'No se pudo leer el formulario multipart.' }
      }
      const input = {
        typeId: intOrNull(parsed.scalars.typeId) ?? 0,
        subtypeId: intOrNull(parsed.scalars.subtypeId) ?? 0,
        documentDate: (parsed.scalars.documentDate ?? '').trim(),
        observations: parsed.scalars.observations ?? null,
        extraFields: parsed.extraFields,
      }
      if (!input.typeId || !input.subtypeId || !input.documentDate) {
        set.status = 400
        return { success: false, error: 'typeId, subtypeId y documentDate son obligatorios' }
      }
      try {
        const result = await updateExisting(db, tenantSlug, params.id, input, parsed.files, {
          changedBy: user?.userId ?? null,
        })
        if (!result.success) {
          set.status = result.error === 'not_found' ? 404 : 422
          return { success: false, error: result.message }
        }
        return { success: true, data: result.data }
      } catch (err) {
        console.error('[employee-files] update failed:', err)
        set.status = 500
        return {
          success: false,
          error: err instanceof Error ? err.message : 'Error interno al actualizar el expediente.',
        }
      }
    },
    {
      beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('employee_files:write')],
      params: t.Object({ id: t.String() }),
    }
  )

  // ── Eliminar expediente ────────────────────────────────────────────────
  .delete(
    '/:id',
    async ({ db, params, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const ok = await deleteEmployeeFile(db, params.id)
      if (!ok) {
        set.status = 404
        return { success: false, error: 'Expediente no encontrado' }
      }
      return { success: true }
    },
    {
      beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('employee_files:delete')],
      params: t.Object({ id: t.String() }),
    }
  )

  // ── Descargar adjunto ──────────────────────────────────────────────────
  .get(
    '/attachments/:id/download',
    async ({ db, params, set }) => {
      if (!db) {
        set.status = 400
        return 'Tenant required'
      }
      const att = await getAttachmentById(db, params.id)
      if (!att) {
        set.status = 404
        return 'Adjunto no encontrado'
      }
      const bytes = await readAttachment(att.filePath)
      if (!bytes) {
        set.status = 404
        return 'Archivo no encontrado en disco'
      }
      set.headers['Content-Type'] = att.mimeType
      set.headers['Content-Disposition'] = `attachment; filename="${att.originalName}"`
      set.headers['Content-Length'] = String(bytes.byteLength)
      return bytes
    },
    {
      beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('employee_files:read')],
      params: t.Object({ id: t.String() }),
    }
  )

  .get(
    '/attachments/:id/preview',
    async ({ db, params, set }) => {
      if (!db) {
        set.status = 400
        return 'Tenant required'
      }
      const att = await getAttachmentById(db, params.id)
      if (!att) {
        set.status = 404
        return 'Adjunto no encontrado'
      }
      const bytes = await readAttachment(att.filePath)
      if (!bytes) {
        set.status = 404
        return 'Archivo no encontrado en disco'
      }
      set.headers['Content-Type'] = att.mimeType
      set.headers['Content-Disposition'] = `inline; filename="${att.originalName}"`
      set.headers['Content-Length'] = String(bytes.byteLength)
      return bytes
    },
    {
      beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('employee_files:read')],
      params: t.Object({ id: t.String() }),
    }
  )

  .delete(
    '/attachments/:id',
    async ({ db, params, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const ok = await deleteAttachmentById(db, params.id)
      if (!ok) {
        set.status = 404
        return { success: false, error: 'Adjunto no encontrado' }
      }
      return { success: true }
    },
    {
      beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('employee_files:delete')],
      params: t.Object({ id: t.String() }),
    }
  )

  // ── Workflow de aprobaciones ───────────────────────────────────────────
  .get(
    '/approvals/pending',
    async ({ db, user, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      // El JWT lleva el role del usuario (un único role hoy en
      // payload; cuando exista el multi-role real se reemplaza).
      const roles: string[] = []
      if (user?.role) roles.push(String(user.role))
      const data = await listPendingApprovals(db, roles)
      return { success: true, data }
    },
    {
      beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('employee_files:approve')],
    }
  )

  .post(
    '/:id/approve',
    async ({ db, params, user, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const result = await approveEmployeeFile(db, params.id, user?.userId ?? '')
      if (!result.success) {
        set.status = 422
        return { success: false, error: result.error }
      }
      return { success: true }
    },
    {
      beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('employee_files:approve')],
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
      const result = await rejectEmployeeFile(db, params.id, user?.userId ?? '', body?.reason ?? '')
      if (!result.success) {
        set.status = 422
        return { success: false, error: result.error }
      }
      return { success: true }
    },
    {
      beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('employee_files:approve')],
      params: t.Object({ id: t.String() }),
      body: t.Object({ reason: t.Optional(t.String()) }),
    }
  )

  // ── CRUD de tipos (configuración) ──────────────────────────────────────
  // Devuelve TODOS los tipos (incluso is_active=0) — el listado abierto
  // en /types ya filtra solo activos para los formularios.
  .get(
    '/admin/types',
    async ({ db, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const data = await listAllTypes(db)
      return { success: true, data }
    },
    {
      beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('employee_files:approve')],
    }
  )

  .post(
    '/admin/types',
    async ({ db, body, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      try {
        const data = await createType(db, body)
        set.status = 201
        return { success: true, data }
      } catch (err) {
        set.status = 422
        return {
          success: false,
          error: err instanceof Error ? err.message : 'No se pudo crear el tipo.',
        }
      }
    },
    {
      beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('employee_files:approve')],
      body: t.Object({
        code: t.String({ minLength: 1, maxLength: 60 }),
        name: t.String({ minLength: 1, maxLength: 120 }),
        description: t.Optional(t.Nullable(t.String())),
        sortOrder: t.Optional(t.Integer()),
        requiresApproval: t.Optional(t.Integer({ minimum: 0, maximum: 1 })),
      }),
    }
  )

  .put(
    '/admin/types/:id',
    async ({ db, params, body, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const id = Number.parseInt(params.id, 10)
      if (!Number.isFinite(id)) {
        set.status = 400
        return { success: false, error: 'id inválido' }
      }
      const ok = await updateType(db, id, body)
      if (!ok) {
        set.status = 404
        return { success: false, error: 'Tipo no encontrado' }
      }
      return { success: true }
    },
    {
      beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('employee_files:approve')],
      params: t.Object({ id: t.String() }),
      body: t.Object({
        name: t.Optional(t.String({ minLength: 1, maxLength: 120 })),
        description: t.Optional(t.Nullable(t.String())),
        sortOrder: t.Optional(t.Integer()),
        requiresApproval: t.Optional(t.Integer({ minimum: 0, maximum: 1 })),
        isActive: t.Optional(t.Integer({ minimum: 0, maximum: 1 })),
      }),
    }
  )

  // ── CRUD de subtipos (configuración) ───────────────────────────────────
  .get(
    '/admin/subtypes',
    async ({ db, query, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const typeId = intOrNull(query.typeId) ?? undefined
      const data = await listAllSubtypes(db, typeId)
      return { success: true, data }
    },
    {
      beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('employee_files:approve')],
      query: t.Object({ typeId: t.Optional(t.String()) }),
    }
  )

  .post(
    '/admin/subtypes',
    async ({ db, body, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      try {
        const data = await createSubtype(db, body)
        set.status = 201
        return { success: true, data }
      } catch (err) {
        set.status = 422
        return {
          success: false,
          error: err instanceof Error ? err.message : 'No se pudo crear el subtipo.',
        }
      }
    },
    {
      beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('employee_files:approve')],
      body: t.Object({
        typeId: t.Integer(),
        code: t.String({ minLength: 1, maxLength: 60 }),
        name: t.String({ minLength: 1, maxLength: 160 }),
        sortOrder: t.Optional(t.Integer()),
        requiresApproval: t.Optional(t.Integer({ minimum: 0, maximum: 1 })),
      }),
    }
  )

  .put(
    '/admin/subtypes/:id',
    async ({ db, params, body, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const id = Number.parseInt(params.id, 10)
      if (!Number.isFinite(id)) {
        set.status = 400
        return { success: false, error: 'id inválido' }
      }
      const ok = await updateSubtype(db, id, body)
      if (!ok) {
        set.status = 404
        return { success: false, error: 'Subtipo no encontrado' }
      }
      return { success: true }
    },
    {
      beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('employee_files:approve')],
      params: t.Object({ id: t.String() }),
      body: t.Object({
        name: t.Optional(t.String({ minLength: 1, maxLength: 160 })),
        sortOrder: t.Optional(t.Integer()),
        requiresApproval: t.Optional(t.Integer({ minimum: 0, maximum: 1 })),
        isActive: t.Optional(t.Integer({ minimum: 0, maximum: 1 })),
      }),
    }
  )

  // ── Catálogo de reglas (configuración del workflow) ────────────────────
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
      beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('employee_files:approve')],
    }
  )

  .post(
    '/approval-rules',
    async ({ db, body, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const result = await upsertApprovalRule(db, {
        typeId: body.typeId,
        subtypeId: body.subtypeId ?? null,
        approverRole: body.approverRole,
      })
      set.status = 201
      return { success: true, data: result }
    },
    {
      beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('employee_files:approve')],
      body: t.Object({
        typeId: t.Integer(),
        subtypeId: t.Optional(t.Nullable(t.Integer())),
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
      beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('employee_files:approve')],
      params: t.Object({ id: t.String() }),
    }
  )
