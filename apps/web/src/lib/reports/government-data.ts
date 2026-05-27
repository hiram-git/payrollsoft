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
const TENANT = 'demo'
const REPORT_LINES_LIMIT = 100000

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

export async function fetchGovernmentReportData(
  payrollId: string,
  authCookie: string
): Promise<GovFetchResult> {
  const headers = { Cookie: `auth=${authCookie}`, 'X-Tenant': TENANT }

  // Parallel: payroll + company + positions + partidas
  let payrollRes: Response
  let companyRes: Response
  let positionsRes: Response
  let partidasRes: Response
  try {
    const params = new URLSearchParams({
      linesPage: '1',
      linesLimit: String(REPORT_LINES_LIMIT),
    })
    ;[payrollRes, companyRes, positionsRes, partidasRes] = await Promise.all([
      fetch(`${API_URL}/payroll/${payrollId}?${params}`, { headers }),
      fetch(`${API_URL}/company`, { headers }),
      fetch(`${API_URL}/positions?limit=10000`, { headers }),
      fetch(`${API_URL}/partidas?limit=10000`, { headers }),
    ])
  } catch {
    return { kind: 'error', status: 502, message: 'Error de conexión con el servidor' }
  }

  if (payrollRes.status === 401) return { kind: 'unauthorized' }
  if (payrollRes.status === 404) return { kind: 'not-found' }
  if (!payrollRes.ok) {
    return { kind: 'error', status: 500, message: 'Error al obtener la planilla' }
  }

  const payrollJson = (await payrollRes.json()) as {
    data: { payroll: GovPayroll; lines: GovLine[] }
  }
  const { payroll, lines } = payrollJson.data

  if (payroll.status !== 'generated' && payroll.status !== 'closed') {
    return { kind: 'bad-status', status: payroll.status }
  }

  // Company config
  let company: GovCompany | null = null
  if (companyRes.ok) {
    try {
      const json = (await companyRes.json()) as { data: GovCompany | null }
      company = json.data ?? null
    } catch {
      company = null
    }
  }

  // Build position → partida lookup
  type PositionRow = { id: string; partidaId: string | null }
  const positionMap = new Map<string, string | null>()
  if (positionsRes.ok) {
    try {
      const json = (await positionsRes.json()) as { data: PositionRow[] }
      for (const p of json.data ?? []) positionMap.set(p.id, p.partidaId)
    } catch {
      // empty map — ungrouped fallback
    }
  }

  const partidaMap = new Map<string, Partida>()
  if (partidasRes.ok) {
    try {
      const json = (await partidasRes.json()) as { data: Partida[] }
      for (const p of json.data ?? []) partidaMap.set(p.id, p)
    } catch {
      // empty
    }
  }

  // Resolve each employee → partida. The payroll lines don't carry
  // positionId directly, so we need to fetch each employee's record
  // for the positionId → position → partidaId chain. Cache per employee.
  const employeePositionCache = new Map<string, string | null>()
  async function resolvePartidaForEmployee(emp: GovLineEmployee): Promise<Partida | null> {
    let posId = emp.positionId ?? null
    if (!posId) {
      if (employeePositionCache.has(emp.id)) {
        posId = employeePositionCache.get(emp.id) ?? null
      } else {
        try {
          const res = await fetch(`${API_URL}/employees/${emp.id}`, { headers })
          if (res.ok) {
            const json = (await res.json()) as { data?: { positionId?: string | null } }
            posId = json.data?.positionId ?? null
          }
        } catch {
          posId = null
        }
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
