import type { PdfCompany, PdfPayroll, PdfPayrollLine } from '../pdf/payroll-pdf'

/**
 * Shape assembled for every payroll report (PDF, XLSX, summary, payslips,
 * Anexo 09, etc.). `lines` is the complete list for the payroll after filters
 * are applied — no pagination leak into the report.
 */
export type PayrollReportData = {
  payroll: PdfPayroll
  lines: PdfPayrollLine[]
  company: PdfCompany | null
}

export type PayrollReportFilters = {
  /** Name/code full-text search — matches the detail-view filter. */
  search?: string
  /** Exact department name filter (applied client-side after fetch). */
  department?: string
  /** Whitelist of employee ids (applied client-side after fetch). */
  employeeIds?: string[]
  /** Organizational payroll type id (forwarded as X-Payroll-Type-Id header). */
  payrollTypeId?: string
}

export type FetchResult =
  | { kind: 'ok'; data: PayrollReportData }
  | { kind: 'unauthorized' }
  | { kind: 'not-found' }
  | { kind: 'error'; status: number; message: string }

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'
const TENANT = 'demo'
const LINES_PER_PAGE = 200

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
 * Single source of truth for fetching a payroll for report generation. Pages
 * 2..N are fetched in parallel (total page count is known after page 1), so
 * a 2000-employee payroll needs one serial round-trip instead of ten. Also
 * fetches company config for the report header alongside the first page.
 */
export async function fetchPayrollReportData(
  payrollId: string,
  authCookie: string,
  filters: PayrollReportFilters = {}
): Promise<FetchResult> {
  const headers = { Cookie: `auth=${authCookie}`, 'X-Tenant': TENANT }

  const pageUrl = (page: number) => {
    const params = new URLSearchParams({
      linesPage: String(page),
      linesLimit: String(LINES_PER_PAGE),
    })
    if (filters.search) params.set('search', filters.search)
    return `${API_URL}/payroll/${payrollId}?${params}`
  }

  let firstRes: Response
  let companyRes: Response
  try {
    ;[firstRes, companyRes] = await Promise.all([
      fetch(pageUrl(1), { headers }),
      fetch(`${API_URL}/company`, { headers }),
    ])
  } catch {
    return { kind: 'error', status: 502, message: 'Error de conexión con el servidor' }
  }

  if (firstRes.status === 401) return { kind: 'unauthorized' }
  if (firstRes.status === 404) return { kind: 'not-found' }
  if (!firstRes.ok) return { kind: 'error', status: 500, message: 'Error al obtener la planilla' }

  const firstJson = (await firstRes.json()) as {
    data: {
      payroll: PdfPayroll
      lines: PdfPayrollLine[]
      linesTotal: number
      linesTotalPages: number
    }
  }

  const totalPages = firstJson.data.linesTotalPages ?? 1
  let allLines: PdfPayrollLine[] = firstJson.data.lines

  if (totalPages > 1) {
    const pages = await Promise.all(
      Array.from({ length: totalPages - 1 }, (_, i) => fetch(pageUrl(i + 2), { headers }))
    )
    for (const res of pages) {
      if (!res.ok) return { kind: 'error', status: 500, message: 'Error al paginar la planilla' }
      const json = (await res.json()) as { data: { lines: PdfPayrollLine[] } }
      allLines = allLines.concat(json.data.lines)
    }
  }

  if (filters.department) {
    const needle = filters.department.toLowerCase()
    allLines = allLines.filter((l) => (l.employee.department ?? '').toLowerCase() === needle)
  }
  if (filters.employeeIds && filters.employeeIds.length > 0) {
    const allow = new Set(filters.employeeIds)
    allLines = allLines.filter((l) => allow.has(l.employee.id))
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
    data: { payroll: firstJson.data.payroll, lines: allLines, company },
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
