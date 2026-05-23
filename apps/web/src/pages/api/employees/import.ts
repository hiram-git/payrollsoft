import type { APIRoute } from 'astro'
import * as XLSX from 'xlsx'
import { getIdentity } from '../../../lib/auth'

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'
const MAX_FILE_BYTES = 2 * 1024 * 1024 // 2 MB

/**
 * Importer de empleados desde un archivo .xlsx.
 *
 * Flujo:
 *  1. Valida sesión + archivo (≤2MB, .xlsx).
 *  2. Parsea el primer sheet con xlsx (ya instalado a nivel de apps/web).
 *  3. Pre-fetch de los catálogos (cargos, funciones, departamentos,
 *     positions) y construcción de mapas code→id para resolver FKs sin
 *     hacer un round-trip por fila.
 *  4. Por cada fila: valida requeridos, normaliza fecha y salario,
 *     resuelve códigos de catálogo y dispara `POST /employees`.
 *  5. Devuelve un resumen JSON con conteos y el detalle por fila para
 *     que la página los pinte inline.
 *
 * Convención de columnas (case-insensitive en el header):
 *   code, firstName, lastName, idNumber, hireDate, baseSalary
 *   email, phone, socialSecurityNumber
 *   cargoCode, funcionCode, departamentoCode, positionCode
 *   payFrequency
 */

type CatalogItem = { id: string; code: string; name: string; isActive?: boolean }
type CatalogResp = { data: CatalogItem[] }

type RowOutcome = {
  rowNumber: number
  code: string
  fullName: string
  status: 'created' | 'skipped' | 'failed'
  message?: string
}

type ImportSummary = {
  total: number
  created: number
  skipped: number
  failed: number
}

const REQUIRED_COLUMNS = [
  'code',
  'firstName',
  'lastName',
  'idNumber',
  'hireDate',
  'baseSalary',
] as const

const PAY_FREQS = new Set(['biweekly', 'monthly', 'weekly'])

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * Normaliza el header del Excel a su columna canónica. Acepta variaciones
 * de mayúsculas y espacios para que un usuario que escriba "First Name"
 * o "firstname" obtenga el mismo binding.
 */
function canonicalKey(raw: string): string | null {
  const k = raw.trim().toLowerCase().replace(/\s+/g, '')
  const map: Record<string, string> = {
    code: 'code',
    codigo: 'code',
    firstname: 'firstName',
    nombre: 'firstName',
    lastname: 'lastName',
    apellido: 'lastName',
    apellidos: 'lastName',
    idnumber: 'idNumber',
    cedula: 'idNumber',
    cédula: 'idNumber',
    hiredate: 'hireDate',
    fechaingreso: 'hireDate',
    basesalary: 'baseSalary',
    salario: 'baseSalary',
    salariobase: 'baseSalary',
    email: 'email',
    correo: 'email',
    phone: 'phone',
    telefono: 'phone',
    teléfono: 'phone',
    socialsecuritynumber: 'socialSecurityNumber',
    seguro: 'socialSecurityNumber',
    seguridadsocial: 'socialSecurityNumber',
    cargocode: 'cargoCode',
    cargo: 'cargoCode',
    funcioncode: 'funcionCode',
    funcion: 'funcionCode',
    función: 'funcionCode',
    departamentocode: 'departamentoCode',
    departamento: 'departamentoCode',
    positioncode: 'positionCode',
    position: 'positionCode',
    posicion: 'positionCode',
    posición: 'positionCode',
    payfrequency: 'payFrequency',
    frecuencia: 'payFrequency',
  }
  return map[k] ?? null
}

/**
 * Convierte la celda `hireDate` a `YYYY-MM-DD`. xlsx puede devolver:
 *  - Date (cuando la celda tiene formato fecha y se parsea con cellDates)
 *  - número (serial de Excel, días desde 1899-12-30)
 *  - string (texto literal)
 */
function normalizeHireDate(raw: unknown): string | null {
  if (raw == null || raw === '') return null
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    return raw.toISOString().slice(0, 10)
  }
  if (typeof raw === 'number') {
    // Serial de Excel: días desde 1899-12-30 (con el bug de Lotus 1-2-3 ya manejado).
    const ms = (raw - 25569) * 86400 * 1000
    const d = new Date(ms)
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10)
    return null
  }
  if (typeof raw === 'string') {
    const s = raw.trim()
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
    // Acepta DD/MM/YYYY tolerantemente.
    const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
    if (m) {
      const [, dd, mm, yyyy] = m
      return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`
    }
    const d = new Date(s)
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10)
  }
  return null
}

function normalizeSalary(raw: unknown): string | null {
  if (raw == null || raw === '') return null
  if (typeof raw === 'number') return raw.toFixed(2)
  if (typeof raw === 'string') {
    const cleaned = raw.replace(/[^0-9.,-]/g, '').replace(',', '.')
    const n = Number(cleaned)
    if (Number.isFinite(n)) return n.toFixed(2)
  }
  return null
}

function strOrNull(raw: unknown): string | null {
  if (raw == null) return null
  const s = String(raw).trim()
  return s.length === 0 ? null : s
}

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
    return jsonResponse(400, {
      ok: false,
      error: 'El archivo excede el tamaño máximo de 2 MB.',
    })
  }
  const lowerName = file.name.toLowerCase()
  if (!lowerName.endsWith('.xlsx') && !lowerName.endsWith('.xls')) {
    return jsonResponse(400, {
      ok: false,
      error: 'Formato no soportado. Usa un archivo .xlsx.',
    })
  }

  // ── Parse workbook ─────────────────────────────────────────────────────
  let rows: Record<string, unknown>[]
  try {
    const buf = await file.arrayBuffer()
    const wb = XLSX.read(buf, { type: 'array', cellDates: true })
    const sheetName = wb.SheetNames[0]
    if (!sheetName) {
      return jsonResponse(400, { ok: false, error: 'El archivo no tiene hojas.' })
    }
    const sheet = wb.Sheets[sheetName]
    // raw=false convierte numbers a string mientras mantiene Date en celdas con formato.
    const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      defval: '',
      raw: true,
    })
    // Re-key: convertir headers de Excel a sus claves canónicas.
    rows = rawRows.map((r) => {
      const out: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(r)) {
        const canon = canonicalKey(key)
        if (canon) out[canon] = value
      }
      return out
    })
  } catch (err) {
    return jsonResponse(400, {
      ok: false,
      error: 'No se pudo procesar el archivo Excel.',
      detail: err instanceof Error ? err.message : String(err),
    })
  }

  if (rows.length === 0) {
    return jsonResponse(400, { ok: false, error: 'La hoja está vacía.' })
  }

  // ── Pre-fetch de catálogos para resolver FKs por code ──────────────────
  let cargos: Map<string, string> = new Map()
  let funciones: Map<string, string> = new Map()
  let departamentos: Map<string, string> = new Map()
  let positions: Map<string, string> = new Map()
  try {
    const [cargosRes, funcionesRes, deptosRes, positionsRes] = await Promise.all([
      fetch(`${API_URL}/cargos`, { headers }),
      fetch(`${API_URL}/funciones`, { headers }),
      fetch(`${API_URL}/departamentos`, { headers }),
      fetch(`${API_URL}/positions?isActive=true`, { headers }),
    ])
    const buildMap = async (res: Response) => {
      if (!res.ok) return new Map<string, string>()
      const json = (await res.json()) as CatalogResp
      const map = new Map<string, string>()
      for (const item of json.data ?? []) {
        if (item.code) map.set(item.code.toUpperCase(), item.id)
      }
      return map
    }
    cargos = await buildMap(cargosRes)
    funciones = await buildMap(funcionesRes)
    departamentos = await buildMap(deptosRes)
    positions = await buildMap(positionsRes)
  } catch (err) {
    return jsonResponse(502, {
      ok: false,
      error: 'No se pudieron cargar los catálogos.',
      detail: err instanceof Error ? err.message : String(err),
    })
  }

  // ── Process rows ───────────────────────────────────────────────────────
  const outcomes: RowOutcome[] = []
  let created = 0
  let skipped = 0
  let failed = 0

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const rowNumber = i + 2 // +1 por header, +1 para indexación 1-based.

    const code = strOrNull(row.code) ?? ''
    const firstName = strOrNull(row.firstName) ?? ''
    const lastName = strOrNull(row.lastName) ?? ''
    const idNumber = strOrNull(row.idNumber) ?? ''
    const fullName = `${lastName}, ${firstName}`.trim().replace(/^,\s*/, '')

    const fail = (message: string) => {
      failed++
      outcomes.push({ rowNumber, code, fullName, status: 'failed', message })
    }

    // Validaciones de requeridos.
    const missing: string[] = []
    for (const col of REQUIRED_COLUMNS) {
      if (!strOrNull((row as Record<string, unknown>)[col])) missing.push(col)
    }
    if (missing.length > 0) {
      fail(`Faltan columnas obligatorias: ${missing.join(', ')}`)
      continue
    }

    const hireDate = normalizeHireDate(row.hireDate)
    if (!hireDate) {
      fail('hireDate inválido. Usa YYYY-MM-DD o una celda con formato fecha.')
      continue
    }

    const baseSalary = normalizeSalary(row.baseSalary)
    if (!baseSalary) {
      fail('baseSalary inválido. Usa un número (p. ej. 750.00).')
      continue
    }

    // Resolución de FKs opcionales.
    const lookup = (
      map: Map<string, string>,
      label: string,
      raw: unknown
    ): { ok: true; id: string | null } | { ok: false; message: string } => {
      const code = strOrNull(raw)
      if (!code) return { ok: true, id: null }
      const id = map.get(code.toUpperCase())
      if (!id) return { ok: false, message: `${label} "${code}" no encontrado` }
      return { ok: true, id }
    }
    const cargo = lookup(cargos, 'cargo', row.cargoCode)
    if (!cargo.ok) {
      fail(cargo.message)
      continue
    }
    const funcion = lookup(funciones, 'funcion', row.funcionCode)
    if (!funcion.ok) {
      fail(funcion.message)
      continue
    }
    const departamento = lookup(departamentos, 'departamento', row.departamentoCode)
    if (!departamento.ok) {
      fail(departamento.message)
      continue
    }
    const position = lookup(positions, 'position', row.positionCode)
    if (!position.ok) {
      fail(position.message)
      continue
    }

    let payFrequency: string | undefined
    const freqRaw = strOrNull(row.payFrequency)
    if (freqRaw) {
      const f = freqRaw.toLowerCase()
      if (!PAY_FREQS.has(f)) {
        fail(`payFrequency inválido: "${freqRaw}". Usa biweekly, monthly o weekly.`)
        continue
      }
      payFrequency = f
    }

    const email = strOrNull(row.email)
    const phone = strOrNull(row.phone)
    const ssn = strOrNull(row.socialSecurityNumber)

    const payload: Record<string, unknown> = {
      code,
      firstName,
      lastName,
      idNumber,
      hireDate,
      baseSalary,
      email,
      phone,
      socialSecurityNumber: ssn,
      jobTitleId: cargo.id,
      jobFunctionId: funcion.id,
      departmentId: departamento.id,
      positionId: position.id,
    }
    if (payFrequency) payload.payFrequency = payFrequency

    let res: Response
    try {
      res = await fetch(`${API_URL}/employees`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
    } catch (err) {
      fail(`Error de red: ${err instanceof Error ? err.message : String(err)}`)
      continue
    }

    if (res.status === 201) {
      created++
      outcomes.push({ rowNumber, code, fullName, status: 'created' })
      continue
    }
    if (res.status === 409) {
      skipped++
      let detail = 'ya existe'
      try {
        const body = (await res.json()) as { error?: string }
        if (body.error) detail = body.error
      } catch {
        // best-effort
      }
      outcomes.push({ rowNumber, code, fullName, status: 'skipped', message: detail })
      continue
    }
    let errMsg = `${res.status} ${res.statusText}`
    try {
      const body = (await res.json()) as { error?: string; message?: string }
      errMsg = body.error ?? body.message ?? errMsg
    } catch {
      // best-effort
    }
    fail(errMsg)
  }

  const summary: ImportSummary = {
    total: outcomes.length,
    created,
    skipped,
    failed,
  }

  return jsonResponse(200, { ok: true, summary, rows: outcomes })
}
