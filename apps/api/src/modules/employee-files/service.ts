import {
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
