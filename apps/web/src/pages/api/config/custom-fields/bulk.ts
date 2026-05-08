import type { APIRoute } from 'astro'
import * as XLSX from 'xlsx'
import { getIdentity } from '../../../../lib/auth'

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'
const MAX_FILE_BYTES = 2 * 1024 * 1024 // 2 MB

type CustomFieldDef = {
  id: string
  code: string
  name: string
  fieldType: 'text' | 'integer' | 'float' | 'date'
  isActive: boolean
}
type Employee = {
  id: string
  code: string
  firstName: string
  lastName: string
  isActive: boolean
  customFields?: Record<string, unknown>
}

type RowOutcome = {
  rowNumber: number
  employeeCode: string
  status: 'updated' | 'skipped' | 'failed'
  message?: string
  changedFields?: number
}

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function normalizeDate(raw: unknown): string | null {
  if (raw == null || raw === '') return null
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    return raw.toISOString().slice(0, 10)
  }
  if (typeof raw === 'number') {
    const ms = (raw - 25569) * 86400 * 1000
    const d = new Date(ms)
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10)
    return null
  }
  if (typeof raw === 'string') {
    const s = raw.trim()
    if (!s) return null
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
    const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
    if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
    const d = new Date(s)
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10)
  }
  return null
}

function strOrNull(raw: unknown): string | null {
  if (raw == null) return null
  const s = String(raw).trim()
  return s.length === 0 ? null : s
}

/**
 * Carga masiva de valores de campos adicionales. Acepta el .xlsx
 * generado por /api/config/custom-fields/bulk/template y por cada
 * fila hace PUT al empleado correspondiente con un `customFields`
 * parchado (solo escribe los campos presentes en la fila; los demás
 * quedan tal cual estén en el jsonb del empleado).
 *
 * Coerción por tipo:
 *   integer/float → Number()
 *   date          → YYYY-MM-DD
 *   text          → string
 *
 * Filas con `code` que no matchea un empleado activo se reportan
 * como `skipped`. Filas con error de PUT se reportan como `failed`
 * con el mensaje del API. La operación NO es transaccional: las
 * filas anteriores ya se aplicaron incluso si una falla más adelante.
 */
export const POST: APIRoute = async ({ request, cookies }) => {
  const identity = getIdentity(cookies)
  if (!identity) return jsonResponse(401, { ok: false, error: 'No autorizado.' })
  const tenant = identity.tenantSlug ?? 'demo'
  const headers = { Cookie: `auth=${identity.raw}`, 'X-Tenant': tenant }

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return jsonResponse(400, { ok: false, error: 'No se pudo leer el formulario.' })
  }
  const file = form.get('file')
  if (!(file instanceof File) || file.size === 0) {
    return jsonResponse(400, { ok: false, error: 'Adjunta un archivo .xlsx.' })
  }
  if (file.size > MAX_FILE_BYTES) {
    return jsonResponse(400, { ok: false, error: 'El archivo excede 2 MB.' })
  }
  if (!/\.(xlsx|xls)$/i.test(file.name)) {
    return jsonResponse(400, { ok: false, error: 'Formato no soportado. Usa .xlsx.' })
  }

  // Parse workbook + first sheet.
  let rawRows: Record<string, unknown>[]
  try {
    const buf = await file.arrayBuffer()
    const wb = XLSX.read(buf, { type: 'array', cellDates: true })
    const sheetName = wb.SheetNames[0]
    if (!sheetName) {
      return jsonResponse(400, { ok: false, error: 'El archivo no tiene hojas.' })
    }
    rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[sheetName], {
      defval: '',
      raw: true,
    })
  } catch (err) {
    return jsonResponse(400, {
      ok: false,
      error: 'No se pudo procesar el archivo.',
      detail: err instanceof Error ? err.message : String(err),
    })
  }
  if (rawRows.length === 0) {
    return jsonResponse(400, { ok: false, error: 'La hoja está vacía.' })
  }

  // Pre-fetch de catálogos.
  let defs: CustomFieldDef[] = []
  let employees: Employee[] = []
  try {
    const [defsRes, empRes] = await Promise.all([
      fetch(`${API_URL}/custom-fields`, { headers }),
      fetch(`${API_URL}/employees?limit=2000`, { headers }),
    ])
    if (!defsRes.ok || !empRes.ok) {
      return jsonResponse(502, { ok: false, error: 'No se pudieron cargar catálogos.' })
    }
    defs = ((await defsRes.json()) as { data: CustomFieldDef[] }).data ?? []
    employees = ((await empRes.json()) as { data: Employee[] }).data ?? []
  } catch (err) {
    return jsonResponse(502, {
      ok: false,
      error: 'Error al consultar catálogos.',
      detail: err instanceof Error ? err.message : String(err),
    })
  }

  const activeDefs = defs.filter((d) => d.isActive)
  const defByCode = new Map(activeDefs.map((d) => [d.code, d]))
  const empByCode = new Map<string, Employee>()
  for (const e of employees) {
    if (e.isActive) empByCode.set(e.code.toUpperCase(), e)
  }

  // Process rows one-by-one (single PUT per fila).
  const outcomes: RowOutcome[] = []
  let updated = 0
  let skipped = 0
  let failed = 0

  for (let i = 0; i < rawRows.length; i++) {
    const row = rawRows[i]
    const rowNumber = i + 2 // header counts as row 1
    const code = strOrNull((row as Record<string, unknown>).code) ?? ''
    if (!code) {
      failed++
      outcomes.push({
        rowNumber,
        employeeCode: '',
        status: 'failed',
        message: 'La columna "code" está vacía.',
      })
      continue
    }
    const emp = empByCode.get(code.toUpperCase())
    if (!emp) {
      skipped++
      outcomes.push({
        rowNumber,
        employeeCode: code,
        status: 'skipped',
        message: 'No se encontró un empleado activo con ese código.',
      })
      continue
    }

    // Para cada definición, si la columna está en la fila, castear.
    const patch: Record<string, unknown> = {}
    let invalidMsg = ''
    let changes = 0
    for (const def of activeDefs) {
      if (!(def.code in row)) continue
      const raw = (row as Record<string, unknown>)[def.code]
      if (raw === '' || raw == null) {
        patch[def.code] = null
        changes++
        continue
      }
      if (def.fieldType === 'integer') {
        const n = Number.parseInt(String(raw), 10)
        if (!Number.isFinite(n)) {
          invalidMsg = `Columna "${def.code}" debe ser un entero.`
          break
        }
        patch[def.code] = n
      } else if (def.fieldType === 'float') {
        const n = Number(String(raw).replace(',', '.'))
        if (!Number.isFinite(n)) {
          invalidMsg = `Columna "${def.code}" debe ser un número.`
          break
        }
        patch[def.code] = n
      } else if (def.fieldType === 'date') {
        const d = normalizeDate(raw)
        if (!d) {
          invalidMsg = `Columna "${def.code}" debe ser una fecha (YYYY-MM-DD).`
          break
        }
        patch[def.code] = d
      } else {
        patch[def.code] = String(raw)
      }
      changes++
    }
    if (invalidMsg) {
      failed++
      outcomes.push({ rowNumber, employeeCode: code, status: 'failed', message: invalidMsg })
      continue
    }
    if (changes === 0) {
      skipped++
      outcomes.push({
        rowNumber,
        employeeCode: code,
        status: 'skipped',
        message: 'Ningún campo adicional para actualizar.',
      })
      continue
    }

    // Merge con el customFields existente: el patch SOLO sobreescribe
    // las claves presentes en la fila, lo demás se preserva.
    const merged = { ...(emp.customFields ?? {}), ...patch }

    let res: Response
    try {
      res = await fetch(`${API_URL}/employees/${emp.id}`, {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // Re-enviamos los campos requeridos por el body schema; el
          // patch real está en customFields. El API ignora valores que
          // ya tiene si no cambian.
          code: emp.code,
          firstName: emp.firstName,
          lastName: emp.lastName,
          // Estos campos se completan con lo que ya hay; si faltan,
          // el API marca missing-fields. No queremos tocarlos.
          customFields: merged,
        }),
      })
    } catch (err) {
      failed++
      outcomes.push({
        rowNumber,
        employeeCode: code,
        status: 'failed',
        message: err instanceof Error ? err.message : String(err),
      })
      continue
    }
    if (res.ok) {
      updated++
      outcomes.push({ rowNumber, employeeCode: code, status: 'updated', changedFields: changes })
      continue
    }
    let detail = `${res.status}`
    try {
      const body = (await res.json()) as { error?: string; message?: string }
      detail = body.message ?? body.error ?? detail
    } catch {
      /* best-effort */
    }
    failed++
    outcomes.push({ rowNumber, employeeCode: code, status: 'failed', message: detail })
  }

  return jsonResponse(200, {
    ok: true,
    summary: {
      total: outcomes.length,
      updated,
      skipped,
      failed,
      definitionsUsed: activeDefs.length,
    },
    rows: outcomes,
  })
}
