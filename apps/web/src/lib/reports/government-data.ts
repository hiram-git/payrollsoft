/**
 * Shared data layer for the three government reports (Transferencias,
 * Recapitulación, SIACAP). Each report pulls from a *generated* payroll
 * and groups results by partida presupuestaria.
 *
 * The chain: payroll_lines → employee → position → partida.
 *
 * Since `getPayrollLinesPaged` doesn't join to `positions` /
 * `partidas_presupuestarias`, we resolve the mapping on the web side
 * with separate fetches — cached so a 500-employee payroll only does
 * one lookup per unique position.
 */

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'
const REPORT_LINES_LIMIT = 100000
const METADATA_TTL_MS = 60_000

// In-process TTL cache for the three metadata endpoints (company,
// positions, partidas). Government reports re-render on every click,
// but the catalog data behind them rarely changes — caching it for
// 60s drops the per-click request count from 4 to 1 once the page is
// warm, which is the difference between hitting the 100 req/min
// global rate limit and not. Keyed by tenant slug so multi-tenant
// instances don't bleed across.
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

// ─── Types shared across all three reports ─────────────────────────────────

export type ConceptEntry = {
  code: string
  name: string
  type: string
  amount: number
}

export type GovLineEmployee = {
  id: string
  code: string
  firstName: string
  lastName: string
  idNumber: string | null
  email: string | null
  department: string | null
  position: string | null
  socialSecurityNumber?: string | null
  baseSalary?: string | null
  positionId?: string | null
}

export type GovLine = {
  line: {
    id: string
    grossAmount: string
    deductions: string
    netAmount: string
    concepts: ConceptEntry[]
  }
  employee: GovLineEmployee
}

export type GovPayroll = {
  id: string
  name: string
  type: string
  frequency: string
  periodStart: string
  periodEnd: string
  paymentDate: string | null
  status: string
}

export type GovCompany = {
  companyName: string | null
  logoEmpresa: string | null
  ruc: string | null
}

export type Partida = {
  id: string
  code: string
  name: string
}

export type PartidaGroup = {
  partida: Partida
  lines: GovLine[]
}

export type GovReportData = {
  payroll: GovPayroll
  company: GovCompany | null
  groups: PartidaGroup[]
  ungrouped: GovLine[]
}

export type GovFetchResult =
  | { kind: 'ok'; data: GovReportData }
  | { kind: 'unauthorized' }
  | { kind: 'not-found' }
  | { kind: 'bad-status'; status: string }
  | { kind: 'error'; status: number; message: string }

// ─── Concept classification (mirrors payroll-pdf.tsx CODE map) ─────────────

const CODE_INCOME = new Set(['SUELDO', 'SALARIO', 'SALARIO_BASE'])
const CODE_SS = new Set(['SS', 'SEGURO_SOCIAL', 'CSS'])
const CODE_SE = new Set(['SE', 'SEGURO_EDUCATIVO', 'SEDU'])
const CODE_SIACAP = new Set(['SIACAP'])
const CODE_ISR = new Set(['ISR', 'ISLR', 'IMP_RENTA', 'IMPUESTO_RENTA'])
const CREDITOR_PREFIX = 'ACR_'

export type ConceptBuckets = {
  sueldo: number
  ingresos: number
  ss: number
  se: number
  siacap: number
  isr: number
  otrasDeduciones: number
  devengado: number
  totalDescuentos: number
  neto: number
}

export function computeBuckets(concepts: ConceptEntry[]): ConceptBuckets {
  let sueldo = 0
  let ingresos = 0
  let ss = 0
  let se = 0
  let siacap = 0
  let isr = 0
  let otrasDeduciones = 0

  for (const c of concepts) {
    const code = c.code?.toUpperCase() ?? ''
    const amount = Number(c.amount) || 0

    if (c.type === 'income') {
      ingresos += amount
      if (CODE_INCOME.has(code)) sueldo = amount
      continue
    }
    if (c.type === 'deduction') {
      if (CODE_SS.has(code)) ss += amount
      else if (CODE_SE.has(code)) se += amount
      else if (CODE_SIACAP.has(code)) siacap += amount
      else if (CODE_ISR.has(code)) isr += amount
      else if (code.startsWith(CREDITOR_PREFIX) || c.code?.startsWith(CREDITOR_PREFIX))
        otrasDeduciones += amount
      else otrasDeduciones += amount
    }
  }

  if (sueldo === 0) sueldo = ingresos
  const devengado = ingresos
  const totalDescuentos = ss + se + siacap + isr + otrasDeduciones
  const neto = devengado - totalDescuentos

  return {
    sueldo,
    ingresos,
    ss,
    se,
    siacap,
    isr,
    otrasDeduciones,
    devengado,
    totalDescuentos,
    neto,
  }
}

// ─── Employer (patrono) contribution rates ─────────────────────────────────

/** Standard patrono rates for Panamá. */
export function computePatrono(
  devengado: number,
  opts: { isThirteenthMonth: boolean; riskRate: number }
) {
  if (opts.isThirteenthMonth) {
    return {
      ssPatrono: round2(devengado * 0.1075),
      sePatrono: 0,
      rpPatrono: 0,
      siacapPatrono: 0,
    }
  }
  return {
    ssPatrono: round2(devengado * 0.1325),
    sePatrono: round2(devengado * 0.015),
    rpPatrono: round2(devengado * opts.riskRate),
    siacapPatrono: 0,
  }
}

function round2(v: number): number {
  return Math.round(v * 100) / 100
}

// ─── Data fetcher ──────────────────────────────────────────────────────────

/**
 * Best-effort fetch that never throws — returns null on any failure
 * and logs the cause to the server log so we can diagnose silent
 * misconfiguration without breaking the report.
 */
async function tryFetchJson<T>(
  label: string,
  url: string,
  headers: Record<string, string>
): Promise<T | null> {
  try {
    const res = await fetch(url, { headers })
    if (!res.ok) {
      console.warn(`[gov-report] ${label} fetch returned ${res.status} for ${url}`)
      return null
    }
    return (await res.json()) as T
  } catch (err) {
    console.warn(`[gov-report] ${label} fetch threw for ${url}:`, err)
    return null
  }
}

export async function fetchGovernmentReportData(
  payrollId: string,
  authCookie: string,
  tenantSlug: string
): Promise<GovFetchResult> {
  const headers = { Cookie: `auth=${authCookie}`, 'X-Tenant': tenantSlug }

  // Critical fetch first — fail fast and surface a precise status so
  // the UI can show a meaningful error instead of "intermittent".
  const params = new URLSearchParams({
    linesPage: '1',
    linesLimit: String(REPORT_LINES_LIMIT),
  })
  let payrollRes: Response
  try {
    payrollRes = await fetch(`${API_URL}/payroll/${payrollId}?${params}`, { headers })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error de conexión'
    console.error(`[gov-report] payroll fetch threw for ${payrollId}:`, err)
    return { kind: 'error', status: 502, message: `No se pudo cargar la planilla: ${message}` }
  }

  if (payrollRes.status === 401) return { kind: 'unauthorized' }
  if (payrollRes.status === 404) return { kind: 'not-found' }
  if (!payrollRes.ok) {
    const body = await payrollRes.text().catch(() => '')
    console.error(
      `[gov-report] payroll fetch returned ${payrollRes.status} for ${payrollId}: ${body}`
    )
    if (payrollRes.status === 429) {
      return {
        kind: 'error',
        status: 429,
        message: 'Se alcanzó el límite de solicitudes. Espera ~15 segundos e intenta de nuevo.',
      }
    }
    return {
      kind: 'error',
      status: payrollRes.status,
      message: `Error al obtener la planilla (HTTP ${payrollRes.status})`,
    }
  }

  let payrollJson: { data: { payroll: GovPayroll; lines: GovLine[] } }
  try {
    payrollJson = (await payrollRes.json()) as typeof payrollJson
  } catch (err) {
    console.error('[gov-report] payroll JSON parse failed:', err)
    return { kind: 'error', status: 500, message: 'Respuesta de planilla inválida' }
  }
  const { payroll, lines } = payrollJson.data

  if (payroll.status !== 'generated' && payroll.status !== 'closed') {
    return { kind: 'bad-status', status: payroll.status }
  }

  // Optional metadata in parallel — failures degrade gracefully.
  // Cache hits skip the network call entirely so a burst of report
  // clicks within the TTL window doesn't run the per-IP rate limiter
  // up to 429.
  type PositionRow = { id: string; budgetItemId: string | null }

  async function fetchCached<T>(
    label: 'company' | 'positions' | 'partidas',
    url: string
  ): Promise<T | null> {
    const cacheKey = `${tenantSlug}:${label}`
    const cached = readCache<T>(cacheKey)
    if (cached !== null) return cached
    const fresh = await tryFetchJson<T>(label, url, headers)
    if (fresh !== null) writeCache(cacheKey, fresh)
    return fresh
  }

  const [companyJson, positionsJson, partidasJson] = await Promise.all([
    fetchCached<{ data: GovCompany | null }>('company', `${API_URL}/company`),
    fetchCached<{ data: PositionRow[] }>('positions', `${API_URL}/positions?limit=10000`),
    fetchCached<{ data: Partida[] }>('partidas', `${API_URL}/budget-items`),
  ])

  const company = companyJson?.data ?? null

  const positionMap = new Map<string, string | null>()
  for (const p of positionsJson?.data ?? []) positionMap.set(p.id, p.budgetItemId)

  const partidaMap = new Map<string, Partida>()
  for (const p of partidasJson?.data ?? []) partidaMap.set(p.id, p)

  // Resolve each employee → partida. The payroll line payload now
  // carries positionId directly (see getPayrollLines), so the previous
  // N+1 fetch fallback only runs for legacy payloads. Cache per
  // employee just in case.
  const employeePositionCache = new Map<string, string | null>()
  async function resolvePartidaForEmployee(emp: GovLineEmployee): Promise<Partida | null> {
    let posId = emp.positionId ?? null
    if (!posId) {
      if (employeePositionCache.has(emp.id)) {
        posId = employeePositionCache.get(emp.id) ?? null
      } else {
        const json = await tryFetchJson<{ data?: { positionId?: string | null } }>(
          'employee',
          `${API_URL}/employees/${emp.id}`,
          headers
        )
        posId = json?.data?.positionId ?? null
        employeePositionCache.set(emp.id, posId)
      }
    }
    if (!posId) return null
    const partidaId = positionMap.get(posId)
    if (!partidaId) return null
    return partidaMap.get(partidaId) ?? null
  }

  // Group lines by partida
  const grouped = new Map<string, { partida: Partida; lines: GovLine[] }>()
  const ungrouped: GovLine[] = []

  for (const entry of lines) {
    const partida = await resolvePartidaForEmployee(entry.employee)
    if (partida) {
      const existing = grouped.get(partida.id)
      if (existing) {
        existing.lines.push(entry)
      } else {
        grouped.set(partida.id, { partida, lines: [entry] })
      }
    } else {
      ungrouped.push(entry)
    }
  }

  const groups = Array.from(grouped.values()).sort((a, b) =>
    a.partida.code.localeCompare(b.partida.code)
  )

  return { kind: 'ok', data: { payroll, company, groups, ungrouped } }
}
