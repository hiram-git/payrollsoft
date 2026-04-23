import type { PdfPayroll, PdfPayrollLine } from '../pdf/payroll-pdf'

/**
 * Shape returned by the API `GET /payroll/:id`. Re-used by every payroll
 * report (PDF, XLSX, summary, payslips, Anexo 09, etc.).
 */
export type PayrollReportData = {
  payroll: PdfPayroll
  lines: PdfPayrollLine[]
}

export type FetchResult =
  | { kind: 'ok'; data: PayrollReportData }
  | { kind: 'unauthorized' }
  | { kind: 'not-found' }
  | { kind: 'error'; status: number; message: string }

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'
const TENANT = 'demo'

/**
 * Single source of truth for fetching a payroll with all its lines for report
 * generation. Centralising this avoids repeating the fetch+error handling in
 * every report endpoint, and makes it easy to add new formats (Excel,
 * payslips, Anexo 09, etc.).
 */
export async function fetchPayrollReportData(
  payrollId: string,
  authCookie: string
): Promise<FetchResult> {
  const headers = { Cookie: `auth=${authCookie}`, 'X-Tenant': TENANT }

  let res: Response
  try {
    res = await fetch(`${API_URL}/payroll/${payrollId}`, { headers })
  } catch {
    return { kind: 'error', status: 502, message: 'Error de conexión con el servidor' }
  }

  if (res.status === 401) return { kind: 'unauthorized' }
  if (res.status === 404) return { kind: 'not-found' }
  if (!res.ok) return { kind: 'error', status: 500, message: 'Error al obtener la planilla' }

  const json = (await res.json()) as { data: PayrollReportData }
  return { kind: 'ok', data: json.data }
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
