import type {
  PdfPersonnelCompany,
  PdfPersonnelEmployee,
  PdfPersonnelGeneratedBy,
} from '../pdf/personnel-pdf'

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'
const TENANT = 'demo'

// API clamps `limit` at 100; walk pages to gather every employee for a
// tenant + payroll-type combo. Cap covers ~5,000 employees per type.
const PAGE_SIZE = 100
const MAX_PAGES = 50

export type PersonnelReportFilters = {
  /** Active payroll-type id from the navbar cookie. */
  payrollTypeId?: string | null
  /** Display name for the type — printed on the PDF chip. */
  payrollTypeName?: string | null
  /** When false, includes inactive employees too (default: true). */
  activeOnly?: boolean
}

export type PersonnelReportData = {
  employees: PdfPersonnelEmployee[]
  company: PdfPersonnelCompany | null
  payrollTypeName: string | null
  generatedBy?: PdfPersonnelGeneratedBy | null
}

export type PersonnelFetchResult =
  | { kind: 'ok'; data: PersonnelReportData }
  | { kind: 'unauthorized' }
  | { kind: 'error'; status: number; message: string }

type ApiEmployee = {
  code: string
  firstName: string
  lastName: string
  idNumber: string | null
  department: string | null
  position: string | null
  hireDate: string | null
  baseSalary: string | null
  payFrequency: string | null
  isActive: boolean
}

/**
 * Fetch the full employee list scoped by the navbar's active payroll
 * type. The API endpoint is paginated (max 100 rows) so we walk pages
 * server-side until exhausted.
 */
export async function fetchPersonnelReportData(
  authCookie: string,
  filters: PersonnelReportFilters = {}
): Promise<PersonnelFetchResult> {
  const headers = { Cookie: `auth=${authCookie}`, 'X-Tenant': TENANT }
  const employees: PdfPersonnelEmployee[] = []
  const activeOnly = filters.activeOnly ?? true

  try {
    for (let page = 1; page <= MAX_PAGES; page++) {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(PAGE_SIZE),
      })
      if (activeOnly) params.set('isActive', 'true')
      if (filters.payrollTypeId) params.set('payrollTypeId', filters.payrollTypeId)

      const res = await fetch(`${API_URL}/employees?${params}`, { headers })
      if (res.status === 401) return { kind: 'unauthorized' }
      if (!res.ok) {
        return {
          kind: 'error',
          status: res.status,
          message: 'Error al obtener el listado de empleados',
        }
      }
      const json = (await res.json()) as { data: ApiEmployee[] }
      const batch = json.data ?? []
      for (const e of batch) {
        employees.push({
          code: e.code,
          firstName: e.firstName,
          lastName: e.lastName,
          idNumber: e.idNumber,
          department: e.department,
          position: e.position,
          hireDate: e.hireDate,
          baseSalary: e.baseSalary,
          payFrequency: e.payFrequency,
          isActive: e.isActive,
        })
      }
      if (batch.length < PAGE_SIZE) break
    }
  } catch {
    return { kind: 'error', status: 502, message: 'Error de conexión con el servidor' }
  }

  let company: PdfPersonnelCompany | null = null
  try {
    const res = await fetch(`${API_URL}/company`, { headers })
    if (res.ok) {
      const json = (await res.json()) as { data: PdfPersonnelCompany | null }
      company = json.data ?? null
    }
  } catch {
    company = null
  }

  return {
    kind: 'ok',
    data: {
      employees,
      company,
      payrollTypeName: filters.payrollTypeName ?? null,
    },
  }
}

/** Slugify a string for use as a Content-Disposition filename. */
export function personnelFileSlug(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
}
