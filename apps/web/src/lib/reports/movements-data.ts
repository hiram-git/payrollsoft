/**
 * Data layer for the employee-file movements report (/reports/movements).
 *
 * Pulls raw movement rows from `/reports/employee-files/rows` (same
 * filters as the aggregated stats endpoint) plus the company config for
 * branding. Catalog metadata (file types, company) is TTL-cached so a
 * burst of report clicks doesn't fan out to the API repeatedly.
 */

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'
const METADATA_TTL_MS = 60_000

type CacheEntry<T> = { value: T; expiresAt: number }
const metadataCache = new Map<string, CacheEntry<unknown>>()

function readCache<T>(key: string): T | null {
  const entry = metadataCache.get(key)
  if (!entry) return null
  if (Date.now() > entry.expiresAt) {
    metadataCache.delete(key)
    return null
  }
  return entry.value as T
}

function writeCache<T>(key: string, value: T): void {
  metadataCache.set(key, { value, expiresAt: Date.now() + METADATA_TTL_MS })
}

// ─── Types ──────────────────────────────────────────────────────────────────

export type MovementRow = {
  id: string
  documentNumber: string
  documentDate: string
  approvalStatus: string
  createdBy: string | null
  createdByName: string
  employeeCode: string
  firstName: string
  lastName: string
  typeName: string
  subtypeName: string
}

export type MovementsCompany = {
  companyName: string | null
  logoEmpresa: string | null
  ruc: string | null
}

export type MovementsFilters = {
  year?: string | null
  from?: string | null
  to?: string | null
  typeId?: string | null
  subtypeId?: string | null
  /** Human-readable names for the PDF filter chip (resolved by caller). */
  typeName?: string | null
  subtypeName?: string | null
}

export type MovementsReportData = {
  rows: MovementRow[]
  total: number
  company: MovementsCompany | null
  filters: MovementsFilters
}

export type MovementsFetchResult =
  | { kind: 'ok'; data: MovementsReportData }
  | { kind: 'unauthorized' }
  | { kind: 'error'; status: number; message: string }

function buildQuery(filters: MovementsFilters, limit: number): string {
  const params = new URLSearchParams()
  if (filters.year) params.set('year', filters.year)
  if (filters.from) params.set('from', filters.from)
  if (filters.to) params.set('to', filters.to)
  if (filters.typeId) params.set('typeId', filters.typeId)
  if (filters.subtypeId) params.set('subtypeId', filters.subtypeId)
  params.set('page', '1')
  params.set('limit', String(limit))
  return params.toString()
}

async function tryFetchJson<T>(
  label: string,
  url: string,
  headers: Record<string, string>
): Promise<T | null> {
  try {
    const res = await fetch(url, { headers })
    if (!res.ok) {
      console.warn(`[movements-report] ${label} fetch returned ${res.status} for ${url}`)
      return null
    }
    return (await res.json()) as T
  } catch (err) {
    console.warn(`[movements-report] ${label} fetch threw for ${url}:`, err)
    return null
  }
}

/**
 * Fetch every matching movement (capped at 10 000) plus the company
 * config for the PDF header. The rows endpoint is the critical fetch —
 * it fails fast with the exact status; company is best-effort.
 */
export async function fetchMovementsReportData(
  filters: MovementsFilters,
  authCookie: string,
  tenantSlug: string
): Promise<MovementsFetchResult> {
  const headers = { Cookie: `auth=${authCookie}`, 'X-Tenant': tenantSlug }

  let rowsRes: Response
  try {
    rowsRes = await fetch(`${API_URL}/reports/employee-files/rows?${buildQuery(filters, 10000)}`, {
      headers,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error de conexión'
    return { kind: 'error', status: 502, message: `No se pudo cargar el reporte: ${message}` }
  }

  if (rowsRes.status === 401) return { kind: 'unauthorized' }
  if (rowsRes.status === 429) {
    return {
      kind: 'error',
      status: 429,
      message: 'Se alcanzó el límite de solicitudes. Espera ~15 segundos e intenta de nuevo.',
    }
  }
  if (!rowsRes.ok) {
    return {
      kind: 'error',
      status: rowsRes.status,
      message: `Error al obtener los movimientos (HTTP ${rowsRes.status})`,
    }
  }

  let rowsJson: { data: { rows: MovementRow[]; total: number } }
  try {
    rowsJson = (await rowsRes.json()) as typeof rowsJson
  } catch {
    return { kind: 'error', status: 500, message: 'Respuesta de movimientos inválida' }
  }

  // Company config (cached, best-effort).
  const cacheKey = `${tenantSlug}:company`
  let company = readCache<MovementsCompany>(cacheKey)
  if (company === null) {
    const json = await tryFetchJson<{ data: MovementsCompany | null }>(
      'company',
      `${API_URL}/company`,
      headers
    )
    company = json?.data ?? null
    if (company) writeCache(cacheKey, company)
  }

  return {
    kind: 'ok',
    data: {
      rows: rowsJson.data.rows ?? [],
      total: rowsJson.data.total ?? 0,
      company,
      filters,
    },
  }
}
