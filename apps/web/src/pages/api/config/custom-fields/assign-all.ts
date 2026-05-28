import type { APIRoute } from 'astro'
import { getIdentity } from '../../../../lib/auth'

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'

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
  customFields?: Record<string, unknown> | null
}

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function normalizeValue(
  fieldType: CustomFieldDef['fieldType'],
  raw: string
): { ok: true; value: unknown } | { ok: false; error: string } {
  const s = raw.trim()
  if (s === '') return { ok: true, value: null }
  if (fieldType === 'integer') {
    const n = Number.parseInt(s, 10)
    if (!Number.isFinite(n)) return { ok: false, error: 'El valor debe ser un entero.' }
    return { ok: true, value: n }
  }
  if (fieldType === 'float') {
    const n = Number(s.replace(',', '.'))
    if (!Number.isFinite(n)) return { ok: false, error: 'El valor debe ser numérico.' }
    return { ok: true, value: n }
  }
  if (fieldType === 'date') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      return { ok: false, error: 'El valor debe estar en formato YYYY-MM-DD.' }
    }
    return { ok: true, value: s }
  }
  return { ok: true, value: s }
}

function isEmpty(v: unknown): boolean {
  return v == null || v === ''
}

/**
 * Asignación masiva del valor de un campo adicional a todos los
 * empleados activos. Body (multipart/form-data o urlencoded):
 *
 *   fieldCode  — código del custom field a setear (obligatorio).
 *   value      — string crudo; se castea por tipo en el servidor.
 *   overwrite  — '1' para pisar el valor existente; vacío deja a
 *                quien ya tiene un valor distinto sin tocar.
 *
 * Itera sobre `/employees` (limit=2000) y para cada empleado hace
 * PUT con `customFields` mergeados. No es transaccional: si un PUT
 * falla, los anteriores quedan aplicados. El resumen viene en la
 * respuesta JSON.
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
  const fieldCode = ((form.get('fieldCode') as string | null) ?? '').trim()
  const rawValue = (form.get('value') as string | null) ?? ''
  const overwrite = form.get('overwrite') === '1'
  if (!fieldCode) return jsonResponse(400, { ok: false, error: 'Falta el código del campo.' })

  // Resolver definición + validar tipo del valor.
  let defs: CustomFieldDef[] = []
  try {
    const res = await fetch(`${API_URL}/custom-fields`, { headers })
    if (!res.ok) {
      return jsonResponse(502, { ok: false, error: 'No se pudo cargar el catálogo.' })
    }
    defs = ((await res.json()) as { data: CustomFieldDef[] }).data ?? []
  } catch (err) {
    return jsonResponse(502, {
      ok: false,
      error: 'Error al consultar el catálogo.',
      detail: err instanceof Error ? err.message : String(err),
    })
  }
  const def = defs.find((d) => d.code === fieldCode && d.isActive)
  if (!def) return jsonResponse(404, { ok: false, error: 'Campo no encontrado o inactivo.' })

  const cast = normalizeValue(def.fieldType, rawValue)
  if (!cast.ok) return jsonResponse(400, { ok: false, error: cast.error })

  // Empleados activos.
  let employees: Employee[] = []
  try {
    const res = await fetch(`${API_URL}/employees?limit=2000&isActive=true`, { headers })
    if (!res.ok) {
      return jsonResponse(502, { ok: false, error: 'No se pudo cargar el listado de empleados.' })
    }
    employees = ((await res.json()) as { data: Employee[] }).data ?? []
  } catch (err) {
    return jsonResponse(502, {
      ok: false,
      error: 'Error al consultar empleados.',
      detail: err instanceof Error ? err.message : String(err),
    })
  }

  const outcomes: Array<{
    employeeCode: string
    status: 'updated' | 'skipped' | 'failed'
    message?: string
  }> = []
  let updated = 0
  let skipped = 0
  let failed = 0

  for (const emp of employees) {
    if (!emp.isActive) continue
    const current = (emp.customFields ?? {}) as Record<string, unknown>
    const existing = current[def.code]
    const same = JSON.stringify(existing ?? null) === JSON.stringify(cast.value ?? null)
    if (same) {
      skipped++
      outcomes.push({ employeeCode: emp.code, status: 'skipped', message: 'Sin cambios.' })
      continue
    }
    if (!overwrite && !isEmpty(existing)) {
      skipped++
      outcomes.push({
        employeeCode: emp.code,
        status: 'skipped',
        message: 'Ya tenía valor (overwrite=false).',
      })
      continue
    }

    const merged = { ...current, [def.code]: cast.value }
    try {
      const res = await fetch(`${API_URL}/employees/${emp.id}`, {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: emp.code,
          firstName: emp.firstName,
          lastName: emp.lastName,
          customFields: merged,
        }),
      })
      if (res.ok) {
        updated++
        outcomes.push({ employeeCode: emp.code, status: 'updated' })
        continue
      }
      const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string }
      failed++
      outcomes.push({
        employeeCode: emp.code,
        status: 'failed',
        message: body.message ?? body.error ?? `HTTP ${res.status}`,
      })
    } catch (err) {
      failed++
      outcomes.push({
        employeeCode: emp.code,
        status: 'failed',
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return jsonResponse(200, {
    ok: true,
    summary: {
      fieldCode: def.code,
      fieldName: def.name,
      total: outcomes.length,
      updated,
      skipped,
      failed,
    },
    rows: outcomes,
  })
}
