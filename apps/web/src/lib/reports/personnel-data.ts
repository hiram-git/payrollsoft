import type {
  PdfDependent,
  PdfPersonnelCompany,
  PdfPersonnelEmployee,
  PdfPersonnelGeneratedBy,
} from '../pdf/personnel-pdf'
import { resolveTenantSlugFromCookie } from '../tenant-slug'

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'

// API clamps `limit` at 100; walk pages to gather every employee for a
// tenant + payroll-type combo. Cap covers ~5,000 employees per type.
const PAGE_SIZE = 100
const MAX_PAGES = 50

export type PersonnelSituacion = 'active' | 'inactive' | 'all'

export type PersonnelReportFilters = {
  /** Active payroll-type id from the navbar cookie. */
  payrollTypeId?: string | null
  /** Display name for the type — printed on the PDF chip. */
  payrollTypeName?: string | null
  /**
   * Situación del colaborador: 'active' (default) | 'inactive' | 'all'.
   * Reemplaza el viejo flag `activeOnly`, que se mantiene como shim.
   */
  situacion?: PersonnelSituacion
  /** @deprecated usar `situacion`. true ⇒ 'active', false ⇒ 'all'. */
  activeOnly?: boolean
  /** Solo colaboradores con discapacidad propia. */
  hasOwnDisability?: boolean
  /** Solo colaboradores con familiares discapacitados. */
  hasFamilyDisability?: boolean
  /** Incluir el detalle de familiares dependientes en el reporte. */
  includeDependents?: boolean
}

export type PersonnelReportData = {
  employees: PdfPersonnelEmployee[]
  company: PdfPersonnelCompany | null
  payrollTypeName: string | null
  /** Lista legible de filtros aplicados para los chips del PDF. */
  filterChips: string[]
  generatedBy?: PdfPersonnelGeneratedBy | null
}

export type PersonnelFetchResult =
  | { kind: 'ok'; data: PersonnelReportData }
  | { kind: 'unauthorized' }
  | { kind: 'error'; status: number; message: string }

type ApiEmployee = {
  id: string
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

type ApiDependent = {
  employeeId: string
  firstName: string
  lastName: string
  idNumber: string | null
  relationship: string | null
  hasDisability: boolean
}

const SITUACION_LABEL: Record<PersonnelSituacion, string> = {
  active: 'Activos',
  inactive: 'De baja',
  all: 'Todas las situaciones',
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
  const headers = {
    Cookie: `auth=${authCookie}`,
    'X-Tenant': resolveTenantSlugFromCookie(authCookie),
  }
  const employees: PdfPersonnelEmployee[] = []
  const situacion: PersonnelSituacion =
    filters.situacion ?? (filters.activeOnly === false ? 'all' : 'active')

  // Dependientes (opcional): un solo fetch masivo agrupado por empleado.
  let depMap: Map<string, PdfDependent[]> | null = null
  if (filters.includeDependents) {
    try {
      const res = await fetch(`${API_URL}/dependents`, { headers })
      if (res.status === 401) return { kind: 'unauthorized' }
      if (res.ok) {
        const json = (await res.json()) as { data: ApiDependent[] }
        depMap = new Map()
        for (const d of json.data ?? []) {
          const arr = depMap.get(d.employeeId) ?? []
          arr.push({
            name: `${d.firstName} ${d.lastName}`.trim(),
            relationship: d.relationship ?? null,
            idNumber: d.idNumber ?? null,
            hasDisability: !!d.hasDisability,
          })
          depMap.set(d.employeeId, arr)
        }
      }
    } catch {
      depMap = null // degrada: el reporte sale sin dependientes
    }
  }

  try {
    for (let page = 1; page <= MAX_PAGES; page++) {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(PAGE_SIZE),
      })
      if (situacion === 'active') params.set('isActive', 'true')
      else if (situacion === 'inactive') params.set('isActive', 'false')
      if (filters.payrollTypeId) params.set('payrollTypeId', filters.payrollTypeId)
      if (filters.hasOwnDisability) params.set('hasOwnDisability', 'true')
      if (filters.hasFamilyDisability) params.set('hasFamilyDisability', 'true')

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
          ...(depMap ? { dependents: depMap.get(e.id) ?? [] } : {}),
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

  const filterChips: string[] = []
  if (filters.payrollTypeName) filterChips.push(`Tipo de planilla: ${filters.payrollTypeName}`)
  filterChips.push(SITUACION_LABEL[situacion])
  if (filters.hasOwnDisability) filterChips.push('Con discapacidad propia')
  if (filters.hasFamilyDisability) filterChips.push('Con familiares discapacitados')
  if (filters.includeDependents) filterChips.push('Con familiares dependientes')

  return {
    kind: 'ok',
    data: {
      employees,
      company,
      payrollTypeName: filters.payrollTypeName ?? null,
      filterChips,
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
