import {
  employeeFileApprovalRules,
  employeeFileAttachments,
  employeeFileSubtypes,
  employeeFileTypes,
  employeeFiles,
} from '@payroll/db'
import { and, desc, eq, sql } from 'drizzle-orm'
import { type FieldDef, getFieldsFor, splitFieldsByKind } from './dynamic-fields'
import {
  ALLOWED_MIME,
  MAX_FILE_BYTES,
  buildRelativePath,
  deleteAttachment,
  writeAttachment,
} from './storage'

// biome-ignore lint/suspicious/noExplicitAny: drizzle generic
type AnyDb = any

export type EmployeeFileInput = {
  employeeId: string
  typeId: number
  subtypeId: number
  documentDate: string // YYYY-MM-DD
  observations?: string | null
  extraFields?: Record<string, unknown>
}

export type FormFile = {
  /** Etiqueta — `'adjunto'` para genéricos, o el nombre del campo
   *  para los `type='file'` del config dinámico. */
  label: string
  originalName: string
  mimeType: string
  bytes: Uint8Array
}

// ─── Helpers de catálogo ─────────────────────────────────────────────────

export async function getTypes(db: AnyDb) {
  return db
    .select()
    .from(employeeFileTypes)
    .where(eq(employeeFileTypes.isActive, 1))
    .orderBy(employeeFileTypes.sortOrder, employeeFileTypes.name)
}

export async function getSubtypes(db: AnyDb, typeId: number) {
  return db
    .select()
    .from(employeeFileSubtypes)
    .where(and(eq(employeeFileSubtypes.typeId, typeId), eq(employeeFileSubtypes.isActive, 1)))
    .orderBy(employeeFileSubtypes.sortOrder, employeeFileSubtypes.name)
}

async function resolveTypeAndSubtype(
  db: AnyDb,
  typeId: number,
  subtypeId: number
): Promise<{ typeCode: string; subtypeCode: string } | null> {
  const [t] = await db
    .select()
    .from(employeeFileTypes)
    .where(eq(employeeFileTypes.id, typeId))
    .limit(1)
  if (!t) return null
  const [s] = await db
    .select()
    .from(employeeFileSubtypes)
    .where(eq(employeeFileSubtypes.id, subtypeId))
    .limit(1)
  if (!s || s.typeId !== typeId) return null
  return { typeCode: t.code, subtypeCode: s.code }
}

// ─── Correlativo ─────────────────────────────────────────────────────────

function formatDocumentNumber(typeId: number, subtypeId: number, year: number, seq: number) {
  const t = String(typeId).padStart(3, '0')
  const s = String(subtypeId).padStart(3, '0')
  const n = String(seq).padStart(4, '0')
  return `T${t}-S${s}-${year}-${n}`
}

/**
 * Vista previa del próximo número sin reservarlo. Sirve para mostrarlo
 * en el formulario antes de guardar. NO usa FOR UPDATE.
 */
export async function previewNextNumber(
  db: AnyDb,
  typeId: number,
  subtypeId: number,
  documentDate: string
): Promise<string> {
  const year = Number.parseInt(documentDate.slice(0, 4), 10)
  const rows = await db
    .select({ max: sql<number>`COALESCE(MAX(${employeeFiles.documentSequence}), 0)` })
    .from(employeeFiles)
    .where(
      and(
        eq(employeeFiles.typeId, typeId),
        eq(employeeFiles.subtypeId, subtypeId),
        eq(employeeFiles.documentYear, year)
      )
    )
  const next = Number(rows[0]?.max ?? 0) + 1
  return formatDocumentNumber(typeId, subtypeId, year, next)
}

// ─── Validación y filtrado de extra_fields ───────────────────────────────

function filterExtraFields(
  fields: FieldDef[],
  raw: Record<string, unknown>
): { ok: true; values: Record<string, unknown> } | { ok: false; error: string } {
  const { scalar } = splitFieldsByKind(fields)
  const allowed = new Set(scalar.map((f) => f.name))
  const values: Record<string, unknown> = {}
  for (const f of scalar) {
    const v = raw[f.name]
    const isEmpty = v == null || v === ''
    if (f.required && isEmpty) {
      return { ok: false, error: `El campo "${f.label}" es obligatorio.` }
    }
    if (!isEmpty) values[f.name] = v
  }
  // descartar claves no declaradas
  for (const k of Object.keys(raw)) {
    if (!allowed.has(k)) continue
  }
  return { ok: true, values }
}

function validateFileFields(
  fields: FieldDef[],
  files: FormFile[]
): { ok: true } | { ok: false; error: string } {
  const fileMap = new Map(files.filter((f) => f.label !== 'adjunto').map((f) => [f.label, f]))
  const { files: fileFields } = splitFieldsByKind(fields)
  for (const ff of fileFields) {
    if (ff.required && !fileMap.has(ff.name)) {
      return { ok: false, error: `El adjunto "${ff.label}" es obligatorio.` }
    }
  }
  for (const f of files) {
    if (f.bytes.byteLength > MAX_FILE_BYTES) {
      return { ok: false, error: `"${f.originalName}" supera los 5 MB permitidos.` }
    }
    if (!ALLOWED_MIME.has(f.mimeType)) {
      return { ok: false, error: `"${f.originalName}" tiene un tipo no permitido (${f.mimeType}).` }
    }
  }
  return { ok: true }
}

// ─── Persistencia ────────────────────────────────────────────────────────

export async function createWithCorrelative(
  db: AnyDb,
  tenantSlug: string,
  input: EmployeeFileInput,
  files: FormFile[],
  options: { createdBy?: string | null } = {}
): Promise<
  | { success: true; data: { id: string; documentNumber: string } }
  | { success: false; error: string; message: string }
> {
  const resolved = await resolveTypeAndSubtype(db, input.typeId, input.subtypeId)
  if (!resolved) {
    return {
      success: false,
      error: 'invalid_catalog',
      message: 'El subtipo no pertenece al tipo seleccionado.',
    }
  }
  const fieldDefs = getFieldsFor(resolved.typeCode, resolved.subtypeCode)
  const filtered = filterExtraFields(fieldDefs, input.extraFields ?? {})
  if (!filtered.ok) {
    return { success: false, error: 'validation', message: filtered.error }
  }
  const fileValidation = validateFileFields(fieldDefs, files)
  if (!fileValidation.ok) {
    return { success: false, error: 'validation', message: fileValidation.error }
  }

  const year = Number.parseInt(input.documentDate.slice(0, 4), 10)

  // Transacción + advisory lock para serializar el cálculo del
  // correlativo bajo concurrencia. PostgreSQL no permite combinar
  // FOR UPDATE con MAX() en una misma query (las funciones de
  // agregación reducen el set y no hay filas que bloquear), así que
  // usamos `pg_advisory_xact_lock` con un hash de la combinación
  // (typeId, subtypeId, year) — sólo dos transacciones que tocan la
  // misma combinación esperan; el resto pasa sin contención.
  // biome-ignore lint/suspicious/noExplicitAny: drizzle transaction generic
  const result = await db.transaction(async (tx: any) => {
    await tx.execute(sql`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${`ef:${input.typeId}:${input.subtypeId}:${year}`}, 0)
      )
    `)
    const lockRows = await tx.execute(sql`
      SELECT COALESCE(MAX(document_sequence), 0) AS max_seq
      FROM employee_files
      WHERE type_id = ${input.typeId}
        AND subtype_id = ${input.subtypeId}
        AND document_year = ${year}
    `)
    const maxSeq = Number((lockRows as Array<{ max_seq: number }>)[0]?.max_seq ?? 0)
    const sequence = maxSeq + 1
    const documentNumber = formatDocumentNumber(input.typeId, input.subtypeId, year, sequence)

    // ¿El subtipo requiere aprobación? El flag declarativo
    // `requires_approval` en `employee_file_subtypes` es el gate.
    // Las reglas en `employee_file_approval_rules` solo declaran
    // _quién_ aprueba (rol), no _si_ se requiere aprobación.
    const subtypeRows = await tx.execute(sql`
      SELECT requires_approval
      FROM employee_file_subtypes
      WHERE id = ${input.subtypeId}
      LIMIT 1
    `)
    const subtypeRequires =
      Number((subtypeRows as Array<{ requires_approval: number }>)[0]?.requires_approval ?? 0) === 1
    const initialStatus = subtypeRequires ? 'pending' : 'approved'
    const needsApproval = subtypeRequires

    const [row] = await tx
      .insert(employeeFiles)
      .values({
        employeeId: input.employeeId,
        typeId: input.typeId,
        subtypeId: input.subtypeId,
        documentDate: input.documentDate,
        documentYear: year,
        documentSequence: sequence,
        documentNumber,
        observations: input.observations ?? null,
        extraFields: filtered.values,
        approvalStatus: initialStatus,
        approvedBy: needsApproval ? null : (options.createdBy ?? null),
        approvedAt: needsApproval ? null : new Date(),
        createdBy: options.createdBy ?? null,
      })
      .returning()

    // Persistir adjuntos en disco + filas en tabla
    for (const f of files) {
      const { relative, absolute } = buildRelativePath(tenantSlug, input.employeeId, f.originalName)
      await writeAttachment(absolute, f.bytes)
      await tx.insert(employeeFileAttachments).values({
        employeeFileId: row.id,
        label: f.label,
        filePath: relative,
        originalName: f.originalName,
        mimeType: f.mimeType,
        fileSize: f.bytes.byteLength,
        uploadedBy: options.createdBy ?? null,
      })
    }
    return { id: row.id as string, documentNumber }
  })

  return { success: true, data: result }
}

export async function updateExisting(
  db: AnyDb,
  tenantSlug: string,
  id: string,
  input: Omit<EmployeeFileInput, 'employeeId'>,
  newFiles: FormFile[],
  options: { changedBy?: string | null } = {}
): Promise<
  | { success: true; data: { id: string; documentNumber: string } }
  | { success: false; error: string; message: string }
> {
  const [existing] = await db.select().from(employeeFiles).where(eq(employeeFiles.id, id)).limit(1)
  if (!existing) return { success: false, error: 'not_found', message: 'Expediente no encontrado.' }

  const resolved = await resolveTypeAndSubtype(db, input.typeId, input.subtypeId)
  if (!resolved) {
    return {
      success: false,
      error: 'invalid_catalog',
      message: 'El subtipo no pertenece al tipo seleccionado.',
    }
  }
  const fieldDefs = getFieldsFor(resolved.typeCode, resolved.subtypeCode)
  const filtered = filterExtraFields(fieldDefs, input.extraFields ?? {})
  if (!filtered.ok) {
    return { success: false, error: 'validation', message: filtered.error }
  }
  const fileValidation = validateFileFields(fieldDefs, newFiles)
  if (!fileValidation.ok) {
    return { success: false, error: 'validation', message: fileValidation.error }
  }

  const newYear = Number.parseInt(input.documentDate.slice(0, 4), 10)
  const needsRenum =
    !existing.documentNumber ||
    existing.typeId !== input.typeId ||
    existing.subtypeId !== input.subtypeId ||
    existing.documentYear !== newYear

  // biome-ignore lint/suspicious/noExplicitAny: drizzle tx
  const result = await db.transaction(async (tx: any) => {
    let documentNumber = existing.documentNumber as string
    let documentSequence = existing.documentSequence as number
    let documentYear = existing.documentYear as number

    if (needsRenum) {
      await tx.execute(sql`
        SELECT pg_advisory_xact_lock(
          hashtextextended(${`ef:${input.typeId}:${input.subtypeId}:${newYear}`}, 0)
        )
      `)
      const lockRows = await tx.execute(sql`
        SELECT COALESCE(MAX(document_sequence), 0) AS max_seq
        FROM employee_files
        WHERE type_id = ${input.typeId}
          AND subtype_id = ${input.subtypeId}
          AND document_year = ${newYear}
      `)
      const maxSeq = Number((lockRows as Array<{ max_seq: number }>)[0]?.max_seq ?? 0)
      documentSequence = maxSeq + 1
      documentYear = newYear
      documentNumber = formatDocumentNumber(
        input.typeId,
        input.subtypeId,
        newYear,
        documentSequence
      )
    }

    await tx
      .update(employeeFiles)
      .set({
        typeId: input.typeId,
        subtypeId: input.subtypeId,
        documentDate: input.documentDate,
        documentYear,
        documentSequence,
        documentNumber,
        observations: input.observations ?? null,
        extraFields: filtered.values,
        updatedAt: new Date(),
      })
      .where(eq(employeeFiles.id, id))

    for (const f of newFiles) {
      const { relative, absolute } = buildRelativePath(
        tenantSlug,
        existing.employeeId as string,
        f.originalName
      )
      await writeAttachment(absolute, f.bytes)
      await tx.insert(employeeFileAttachments).values({
        employeeFileId: id,
        label: f.label,
        filePath: relative,
        originalName: f.originalName,
        mimeType: f.mimeType,
        fileSize: f.bytes.byteLength,
        uploadedBy: options.changedBy ?? null,
      })
    }
    return { id, documentNumber }
  })

  return { success: true, data: result }
}

// ─── Lecturas ────────────────────────────────────────────────────────────

export async function listByEmployee(db: AnyDb, employeeId: string) {
  return db
    .select()
    .from(employeeFiles)
    .where(eq(employeeFiles.employeeId, employeeId))
    .orderBy(desc(employeeFiles.documentDate), desc(employeeFiles.createdAt))
}

export async function getById(db: AnyDb, id: string) {
  const [row] = await db.select().from(employeeFiles).where(eq(employeeFiles.id, id)).limit(1)
  if (!row) return null
  const atts = await db
    .select()
    .from(employeeFileAttachments)
    .where(eq(employeeFileAttachments.employeeFileId, id))
    .orderBy(employeeFileAttachments.createdAt)
  return { ...row, attachments: atts }
}

export async function getAttachmentById(db: AnyDb, attachmentId: string) {
  const [att] = await db
    .select()
    .from(employeeFileAttachments)
    .where(eq(employeeFileAttachments.id, attachmentId))
    .limit(1)
  return att ?? null
}

// ─── Delete ──────────────────────────────────────────────────────────────

export async function deleteEmployeeFile(db: AnyDb, id: string): Promise<boolean> {
  const [row] = await db.select().from(employeeFiles).where(eq(employeeFiles.id, id)).limit(1)
  if (!row) return false
  const atts = await db
    .select()
    .from(employeeFileAttachments)
    .where(eq(employeeFileAttachments.employeeFileId, id))
  for (const a of atts) {
    try {
      await deleteAttachment(a.filePath)
    } catch {
      /* best-effort: el record igual se borra abajo */
    }
  }
  // attachments tienen FK ON DELETE CASCADE → se eliminan al borrar el padre.
  await db.delete(employeeFiles).where(eq(employeeFiles.id, id))
  return true
}

export async function deleteAttachmentById(db: AnyDb, attachmentId: string): Promise<boolean> {
  const [a] = await db
    .select()
    .from(employeeFileAttachments)
    .where(eq(employeeFileAttachments.id, attachmentId))
    .limit(1)
  if (!a) return false
  try {
    await deleteAttachment(a.filePath)
  } catch {
    /* best-effort */
  }
  await db.delete(employeeFileAttachments).where(eq(employeeFileAttachments.id, attachmentId))
  return true
}

// ─── Workflow de aprobaciones ────────────────────────────────────────────

/**
 * Lista los expedientes en estado `pending` que el usuario puede
 * aprobar dados sus roles. La regla:
 *
 *   1. Si hay un `employee_file_approval_rules` activo que matchea
 *      el (type, subtype), el approver_role manda.
 *   2. Si NO hay regla, el fallback es `tenant_admin`.
 *
 * `tenant_admin` siempre ve todos los pendientes — actúa como
 * aprobador universal.
 */
export async function listPendingApprovals(db: AnyDb, userRoles: string[]): Promise<unknown[]> {
  if (userRoles.length === 0) return []
  const isAdmin = userRoles.includes('tenant_admin')
  // biome-ignore lint/suspicious/noExplicitAny: drizzle rows
  const rows: any[] = await db.execute(sql`
    SELECT ef.*,
           t.name AS type_name,
           s.name AS subtype_name,
           e.code AS employee_code,
           e.first_name AS employee_first_name,
           e.last_name AS employee_last_name
    FROM employee_files ef
    JOIN employee_file_types t ON t.id = ef.type_id
    JOIN employee_file_subtypes s ON s.id = ef.subtype_id
    JOIN employees e ON e.id = ef.employee_id
    WHERE ef.approval_status = 'pending'
      AND (
        ${isAdmin}::boolean = true
        OR EXISTS (
          SELECT 1 FROM employee_file_approval_rules r
          WHERE r.is_active = 1
            AND r.type_id = ef.type_id
            AND (r.subtype_id = ef.subtype_id OR r.subtype_id IS NULL)
            AND r.approver_role = ANY(${userRoles})
        )
      )
    ORDER BY ef.created_at ASC
  `)
  return rows
}

export async function approveEmployeeFile(
  db: AnyDb,
  id: string,
  userId: string
): Promise<{ success: true } | { success: false; error: string }> {
  const [existing] = await db.select().from(employeeFiles).where(eq(employeeFiles.id, id)).limit(1)
  if (!existing) return { success: false, error: 'Expediente no encontrado.' }
  if (existing.approvalStatus !== 'pending') {
    return { success: false, error: `El expediente ya está ${existing.approvalStatus}.` }
  }
  await db
    .update(employeeFiles)
    .set({
      approvalStatus: 'approved',
      approvedBy: userId,
      approvedAt: new Date(),
      rejectionReason: null,
      updatedAt: new Date(),
    })
    .where(eq(employeeFiles.id, id))
  return { success: true }
}

export async function rejectEmployeeFile(
  db: AnyDb,
  id: string,
  userId: string,
  reason: string
): Promise<{ success: true } | { success: false; error: string }> {
  const [existing] = await db.select().from(employeeFiles).where(eq(employeeFiles.id, id)).limit(1)
  if (!existing) return { success: false, error: 'Expediente no encontrado.' }
  if (existing.approvalStatus !== 'pending') {
    return { success: false, error: `El expediente ya está ${existing.approvalStatus}.` }
  }
  await db
    .update(employeeFiles)
    .set({
      approvalStatus: 'rejected',
      approvedBy: userId,
      approvedAt: new Date(),
      rejectionReason: reason.trim() || 'Sin razón especificada.',
      updatedAt: new Date(),
    })
    .where(eq(employeeFiles.id, id))
  return { success: true }
}

// ─── CRUD de catálogo (tipos y subtipos) ─────────────────────────────────

export async function listAllTypes(db: AnyDb) {
  return db
    .select()
    .from(employeeFileTypes)
    .orderBy(employeeFileTypes.sortOrder, employeeFileTypes.name)
}

export async function listAllSubtypes(db: AnyDb, typeId?: number) {
  const q = db.select().from(employeeFileSubtypes)
  const rows = typeId
    ? await q
        .where(eq(employeeFileSubtypes.typeId, typeId))
        .orderBy(employeeFileSubtypes.sortOrder, employeeFileSubtypes.name)
    : await q.orderBy(
        employeeFileSubtypes.typeId,
        employeeFileSubtypes.sortOrder,
        employeeFileSubtypes.name
      )
  return rows
}

export async function createType(
  db: AnyDb,
  input: {
    code: string
    name: string
    description?: string | null
    sortOrder?: number
    requiresApproval?: number
  }
): Promise<{ id: number }> {
  const [row] = await db
    .insert(employeeFileTypes)
    .values({
      code: input.code,
      name: input.name,
      description: input.description ?? null,
      sortOrder: input.sortOrder ?? 0,
      requiresApproval: input.requiresApproval ?? 0,
    })
    .returning()
  return { id: row.id as number }
}

export async function updateType(
  db: AnyDb,
  id: number,
  input: {
    name?: string
    description?: string | null
    sortOrder?: number
    requiresApproval?: number
    isActive?: number
  }
): Promise<boolean> {
  const res = await db
    .update(employeeFileTypes)
    .set(input)
    .where(eq(employeeFileTypes.id, id))
    .returning()
  return res.length > 0
}

export async function createSubtype(
  db: AnyDb,
  input: {
    typeId: number
    code: string
    name: string
    sortOrder?: number
    requiresApproval?: number
  }
): Promise<{ id: number }> {
  const [row] = await db
    .insert(employeeFileSubtypes)
    .values({
      typeId: input.typeId,
      code: input.code,
      name: input.name,
      sortOrder: input.sortOrder ?? 0,
      requiresApproval: input.requiresApproval ?? 0,
    })
    .returning()
  return { id: row.id as number }
}

export async function updateSubtype(
  db: AnyDb,
  id: number,
  input: {
    name?: string
    sortOrder?: number
    requiresApproval?: number
    isActive?: number
  }
): Promise<boolean> {
  const res = await db
    .update(employeeFileSubtypes)
    .set(input)
    .where(eq(employeeFileSubtypes.id, id))
    .returning()
  return res.length > 0
}

// ─── Reglas de aprobación ────────────────────────────────────────────────

export async function listApprovalRules(db: AnyDb) {
  return db
    .select()
    .from(employeeFileApprovalRules)
    .where(eq(employeeFileApprovalRules.isActive, 1))
}

export async function upsertApprovalRule(
  db: AnyDb,
  input: { typeId: number; subtypeId: number | null; approverRole: string }
): Promise<{ id: string }> {
  const [row] = await db
    .insert(employeeFileApprovalRules)
    .values({
      typeId: input.typeId,
      subtypeId: input.subtypeId,
      approverRole: input.approverRole,
    })
    .onConflictDoNothing()
    .returning()
  return { id: row?.id ?? '' }
}

export async function deactivateApprovalRule(db: AnyDb, id: string): Promise<boolean> {
  const res = await db
    .update(employeeFileApprovalRules)
    .set({ isActive: 0 })
    .where(eq(employeeFileApprovalRules.id, id))
    .returning()
  return res.length > 0
}
