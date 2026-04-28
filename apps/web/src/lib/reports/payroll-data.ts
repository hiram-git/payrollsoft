import type { PdfCompany, PdfGeneratedBy, PdfPayroll, PdfPayrollLine } from '../pdf/payroll-pdf'

/**
 * Shape assembled for every payroll report (PDF, XLSX, summary, payslips,
 * Anexo 09, etc.). `lines` is the complete list for the payroll after filters
 * are applied — no pagination leak into the report.
 */
export type PayrollReportData = {
  payroll: PdfPayroll
  lines: PdfPayrollLine[]
  company: PdfCompany | null
  /** Resolved generator details from the payroll_reports row, if any. */
  generatedBy?: PdfGeneratedBy | null
}

export type PayrollReportFilters = {
  /** Name/code full-text search — matches the detail-view filter. */
  search?: string
  /** Exact department name filter (applied client-side after fetch). */
  department?: string
  /** Whitelist of employee ids (applied client-side after fetch). */
  employeeIds?: string[]
  /** Organizational payroll type id (reserved; currently forwarded only for
   *  forward compatibility — the API does not filter on it yet). */
  payrollTypeId?: string
}

export type FetchResult =
  | { kind: 'ok'; data: PayrollReportData }
  | { kind: 'unauthorized' }
  | { kind: 'not-found' }
  | { kind: 'error'; status: number; message: string }

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'
const TENANT = 'demo'

// Large enough to hold any real-world payroll in a single call. The API query
// builder caps the effective LIMIT, so this is a request-side sentinel that
// resolves server-side to "return everything".
const REPORT_LINES_LIMIT = 100000

/**
 * Parse the filter query string and the active-type cookie into the shape the
 * fetcher expects. Shared by `/api/payroll/:id/pdf` and
 * `/api/reports/payroll/:id/pdf` so both routes apply identical semantics.
 */
export function parsePayrollReportFilters(
  searchParams: URLSearchParams,
  activePayrollTypeCookie?: string | null
): PayrollReportFilters {
  const filters: PayrollReportFilters = {
    search: searchParams.get('search') ?? undefined,
    department: searchParams.get('department') ?? undefined,
    payrollTypeId: searchParams.get('payrollTypeId') ?? activePayrollTypeCookie ?? undefined,
  }

  const employeeIdsParam = searchParams.get('employeeIds')
  if (employeeIdsParam) {
    const ids = employeeIdsParam
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    if (ids.length > 0) filters.employeeIds = ids
  }

  return filters
}

/**
 * Single source of truth for fetching a payroll for report generation.
 * Fires two parallel requests — the full payroll (no pagination) and the
 * company config — so every caller pays one serial round-trip regardless of
 * payroll size.
 */
export async function fetchPayrollReportData(
  payrollId: string,
  authCookie: string,
  filters: PayrollReportFilters = {}
): Promise<FetchResult> {
  const headers = { Cookie: `auth=${authCookie}`, 'X-Tenant': TENANT }

  const params = new URLSearchParams({
    linesPage: '1',
    linesLimit: String(REPORT_LINES_LIMIT),
  })
  if (filters.search) params.set('search', filters.search)

  let payrollRes: Response
  let companyRes: Response
  try {
    ;[payrollRes, companyRes] = await Promise.all([
      fetch(`${API_URL}/payroll/${payrollId}?${params}`, { headers }),
      fetch(`${API_URL}/company`, { headers }),
    ])
  } catch {
    return { kind: 'error', status: 502, message: 'Error de conexión con el servidor' }
  }

  if (payrollRes.status === 401) return { kind: 'unauthorized' }
  if (payrollRes.status === 404) return { kind: 'not-found' }
  if (!payrollRes.ok) return { kind: 'error', status: 500, message: 'Error al obtener la planilla' }

  const payrollJson = (await payrollRes.json()) as {
    data: { payroll: PdfPayroll; lines: PdfPayrollLine[] }
  }

  let lines: PdfPayrollLine[] = payrollJson.data.lines
  if (filters.department) {
    const needle = filters.department.toLowerCase()
    lines = lines.filter((l) => (l.employee.department ?? '').toLowerCase() === needle)
  }
  if (filters.employeeIds && filters.employeeIds.length > 0) {
    const allow = new Set(filters.employeeIds)
    lines = lines.filter((l) => allow.has(l.employee.id))
  }

  let company: PdfCompany | null = null
  if (companyRes.ok) {
    try {
      const json = (await companyRes.json()) as { data: PdfCompany | null }
      company = json.data ?? null
    } catch {
      company = null
    }
  }

  return {
    kind: 'ok',
    data: { payroll: payrollJson.data.payroll, lines, company },
  }
}

/**
 * Slugify a payroll name for use as a filename. Any character outside the
 * ASCII alphanumeric set collapses to a single dash; leading/trailing dashes
 * are trimmed. Good enough for a `Content-Disposition` filename.
 */
export function payrollFileSlug(name: string) {
  return name
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
}
