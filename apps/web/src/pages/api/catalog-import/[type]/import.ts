/**
 * POST /api/catalog-import/:type/import
 *
 * Importador genérico de catálogos. Acepta un .xlsx con headers que
 * matchean (por nombre o alias) las columnas declaradas en el config
 * del catálogo, y POSTea cada fila al endpoint del backend.
 *
 * El flujo replica 1:1 el de `/api/employees/import` pero es
 * parametrizado por la config de `@lib/catalog-import/config.ts`:
 * agregar un catálogo nuevo es sólo agregar una entrada.
 *
 * Respuesta: { ok, summary: { total, created, skipped, failed }, rows }
 */
import type { APIRoute } from 'astro'
import * as XLSX from 'xlsx'
import { getIdentity } from '../../../../lib/auth'
import { canonicalKey, getCatalogConfig } from '../../../../lib/catalog-import/config'

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'
const MAX_FILE_SIZE = 2 * 1024 * 1024

function strOrNull(raw: unknown): string | null {
  if (raw == null) return null
  const s = String(raw).trim()
  return s === '' ? null : s
}

function normalizeSalary(raw: unknown): string | null {
  if (raw == null || raw === '') return null
  const n = Number(String(raw).replace(/[$,\s]/g, ''))
  return Number.isFinite(n) ? n.toFixed(2) : null
}

type CatalogMap = Map<string, string>

async function fetchCatalog(
  apiUrl: string,
  path: string,
  headers: Record<string, string>
): Promise<CatalogMap> {
  const map: CatalogMap = new Map()
  try {
    const res = await fetch(`${apiUrl}${path}`, { headers })
    if (!res.ok) return map
    const json = (await res.json()) as { data?: Array<{ id: string; code: string }> }
    for (const item of json.data ?? []) {
      map.set(String(item.code).toUpperCase().trim(), item.id)
    }
  } catch {
    /* best-effort */
  }
  return map
}

export const POST: APIRoute = async ({ params, request, cookies }) => {
  const identity = getIdentity(cookies)
  if (!identity) {
    return new Response(JSON.stringify({ ok: false, error: 'No autorizado' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  const tenant = identity.tenantSlug ?? 'demo'
  const authHeaders = { Cookie: `auth=${identity.raw}`, 'X-Tenant': tenant }

  const config = getCatalogConfig(params.type ?? '')
  if (!config) {
    return new Response(JSON.stringify({ ok: false, error: 'Catálogo no reconocido' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const formData = await request.formData()
  const file = formData.get('file')
  if (!file || !(file instanceof File)) {
    return new Response(JSON.stringify({ ok: false, error: 'Selecciona un archivo .xlsx' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  if (file.size > MAX_FILE_SIZE) {
    return new Response(
      JSON.stringify({ ok: false, error: 'El archivo supera los 2 MB permitidos.' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    )
  }
  if (!file.name.match(/\.xlsx?$/i)) {
    return new Response(JSON.stringify({ ok: false, error: 'Solo se aceptan archivos .xlsx' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const buffer = new Uint8Array(await file.arrayBuffer())
  const wb = XLSX.read(buffer, { cellDates: true })
  const sheetName = wb.SheetNames[0]
  if (!sheetName) {
    return new Response(JSON.stringify({ ok: false, error: 'El archivo no tiene hojas.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[sheetName])
  if (rawRows.length === 0) {
    return new Response(
      JSON.stringify({ ok: false, error: 'La hoja está vacía (sin filas de datos).' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    )
  }

  // Normalizar headers
  const firstRow = rawRows[0]
  const keyMap = new Map<string, string>()
  for (const rawKey of Object.keys(firstRow)) {
    const canonical = canonicalKey(rawKey, config)
    if (canonical) keyMap.set(rawKey, canonical)
  }

  // Verificar que todos los required estén presentes
  const presentKeys = new Set(keyMap.values())
  const missingRequired = config.required.filter((c) => !presentKeys.has(c.key))
  if (missingRequired.length > 0) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: `Faltan columnas obligatorias: ${missingRequired.map((c) => c.label).join(', ')}`,
      }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    )
  }

  // Pre-fetch de dependencias para resolver códigos → IDs
  const depMaps: Record<string, CatalogMap> = {}
  const depPaths: Record<string, string> = {
    cargos: '/job-titles',
    funciones: '/job-functions',
    departamentos: '/departments',
    partidas: '/budget-items',
  }
  for (const dep of config.dependencies) {
    depMaps[dep] = await fetchCatalog(API_URL, depPaths[dep] ?? `/${dep}`, authHeaders)
  }

  // Mapeos de campos opcionales que requieren resolución code→id
  const fkResolutions: Record<string, { dep: string; idField: string }> = {
    parentCode: { dep: 'departamentos', idField: 'parentId' },
    cargoCode: { dep: 'cargos', idField: 'jobTitleId' },
    funcionCode: { dep: 'funciones', idField: 'jobFunctionId' },
    departamentoCode: { dep: 'departamentos', idField: 'departmentId' },
    partidaCode: { dep: 'partidas', idField: 'budgetItemId' },
  }

  const summary = { total: rawRows.length, created: 0, skipped: 0, failed: 0 }
  const rows: Array<{
    row: number
    code: string
    name: string
    status: 'created' | 'skipped' | 'failed'
    message?: string
  }> = []

  for (let i = 0; i < rawRows.length; i++) {
    const raw = rawRows[i]
    const mapped: Record<string, unknown> = {}
    for (const [rawKey, canonical] of keyMap.entries()) {
      mapped[canonical] = raw[rawKey]
    }

    const code = strOrNull(mapped.code)
    const name = strOrNull(mapped.name)
    const rowNum = i + 2

    if (!code || !name) {
      summary.failed++
      rows.push({
        row: rowNum,
        code: code ?? '?',
        name: name ?? '?',
        status: 'failed',
        message: 'Falta código o nombre (obligatorios).',
      })
      continue
    }

    // Construir el body del POST al API
    const body: Record<string, unknown> = { code, name }

    // Campos opcionales simples (no FK)
    for (const col of config.optional) {
      if (col.key in fkResolutions) continue
      const val = strOrNull(mapped[col.key])
      if (val != null) body[col.key] = val
    }

    // Campos que requieren FK resolution
    for (const col of config.optional) {
      const fk = fkResolutions[col.key]
      if (!fk) continue
      const codeVal = strOrNull(mapped[col.key])
      if (!codeVal) continue
      const map = depMaps[fk.dep]
      if (!map) continue
      const resolvedId = map.get(codeVal.toUpperCase())
      if (resolvedId) {
        body[fk.idField] = resolvedId
      } else {
        summary.failed++
        rows.push({
          row: rowNum,
          code,
          name,
          status: 'failed',
          message: `${col.label}: código "${codeVal}" no encontrado en el catálogo.`,
        })
      }
    }

    // Si hubo un fk resolution failure arriba ya hicimos continue
    if (rows.length > 0 && rows[rows.length - 1]?.row === rowNum) continue

    // Campo especial: salary se normaliza (estructura)
    if (mapped.salary !== undefined) {
      const salary = normalizeSalary(mapped.salary)
      if (!salary) {
        summary.failed++
        rows.push({
          row: rowNum,
          code,
          name,
          status: 'failed',
          message: `Salario inválido: "${mapped.salary}".`,
        })
        continue
      }
      body.salary = salary
    }

    // Verificar que campos required extra (ej. salary en estructura) tengan valor
    for (const req of config.required) {
      if (req.key === 'code' || req.key === 'name') continue
      if (!body[req.key]) {
        summary.failed++
        rows.push({
          row: rowNum,
          code,
          name,
          status: 'failed',
          message: `Campo obligatorio "${req.label}" vacío.`,
        })
        break
      }
    }
    if (rows.length > 0 && rows[rows.length - 1]?.row === rowNum) continue

    // POST al backend
    try {
      const res = await fetch(`${API_URL}${config.apiPath}`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (res.status === 201) {
        summary.created++
        rows.push({ row: rowNum, code, name, status: 'created' })
      } else if (res.status === 409) {
        summary.skipped++
        rows.push({
          row: rowNum,
          code,
          name,
          status: 'skipped',
          message: `Código "${code}" ya existe — omitido.`,
        })
      } else {
        const errJson = (await res.json().catch(() => ({}))) as { error?: string }
        summary.failed++
        rows.push({
          row: rowNum,
          code,
          name,
          status: 'failed',
          message: errJson.error ?? `HTTP ${res.status}`,
        })
      }
    } catch (err) {
      summary.failed++
      rows.push({
        row: rowNum,
        code,
        name,
        status: 'failed',
        message: err instanceof Error ? err.message : 'Error de red',
      })
    }
  }

  return new Response(JSON.stringify({ ok: true, summary, rows }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}
