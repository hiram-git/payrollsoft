import type { APIRoute } from 'astro'
import * as XLSX from 'xlsx'
import { getIdentity } from '../../../../lib/auth'

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'

type ApiEmployee = {
  id: string
  code: string
  firstName: string
  lastName: string
  idNumber: string | null
  email: string | null
  phone: string | null
  department: string | null
  position: string | null
  hireDate: string | null
  baseSalary: string | null
  payFrequency: string | null
  isActive: boolean
  customFields?: Record<string, unknown>
}

type CustomFieldDef = {
  code: string
  name: string
  fieldType: 'text' | 'integer' | 'float' | 'date'
  isActive: boolean
}

const FREQ_LABEL: Record<string, string> = {
  weekly: 'Semanal',
  biweekly: 'Quincenal',
  monthly: 'Mensual',
}

/**
 * Reporte de personal en .xlsx con columnas adicionales seleccionables.
 *
 * Query:
 *   payrollTypeId — filtra por tipo de planilla (mismo cookie del navbar
 *                   si no se pasa).
 *   fields        — lista de códigos de `custom_field_definitions` a
 *                   incluir como columnas extra, separados por coma.
 *                   Si está vacío, solo van las columnas estándar.
 *
 * El xlsx tiene una sola hoja "Personal" con header en negrita y filas
 * por empleado activo. La generación es en memoria (los listados de
 * personal típicos quedan muy por debajo de 5 MB).
 */
export const GET: APIRoute = async ({ cookies, url }) => {
  const identity = getIdentity(cookies)
  if (!identity) return new Response('Unauthorized', { status: 401 })
  const tenant = identity.tenantSlug ?? 'demo'
  const headers = { Cookie: `auth=${identity.raw}`, 'X-Tenant': tenant }

  const cookieTypeId = cookies.get('payroll.activeTypeId')?.value ?? null
  const queryTypeId = url.searchParams.get('payrollTypeId')
  const payrollTypeId = queryTypeId ?? cookieTypeId

  const requestedFields = (url.searchParams.get('fields') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  // Catálogo de custom fields visibles al usuario (la API ya filtra por
  // readPermission, así que no podemos exfiltrar campos restringidos).
  let defs: CustomFieldDef[] = []
  try {
    const res = await fetch(`${API_URL}/custom-fields`, { headers })
    if (res.ok) {
      defs = (((await res.json()) as { data: CustomFieldDef[] }).data ?? []).filter(
        (d) => d.isActive
      )
    }
  } catch {
    /* sin definiciones, exporta solo las columnas estándar */
  }
  const defByCode = new Map(defs.map((d) => [d.code, d]))
  const selectedDefs = requestedFields
    .map((c) => defByCode.get(c))
    .filter((d): d is CustomFieldDef => Boolean(d))

  // Walk pages — el endpoint cap-ea limit a 100. 5,000 empleados es de
  // sobra para el caso típico.
  const PAGE_SIZE = 100
  const MAX_PAGES = 50
  const employees: ApiEmployee[] = []
  for (let page = 1; page <= MAX_PAGES; page++) {
    const params = new URLSearchParams({
      page: String(page),
      limit: String(PAGE_SIZE),
      isActive: 'true',
    })
    if (payrollTypeId) params.set('payrollTypeId', payrollTypeId)
    const res = await fetch(`${API_URL}/employees?${params}`, { headers })
    if (res.status === 401) return new Response('Unauthorized', { status: 401 })
    if (!res.ok) {
      return new Response(`Error al cargar empleados (HTTP ${res.status})`, { status: 502 })
    }
    const json = (await res.json()) as { data: ApiEmployee[] }
    const batch = json.data ?? []
    employees.push(...batch)
    if (batch.length < PAGE_SIZE) break
  }

  // Build worksheet rows
  const baseHeader = [
    'Código',
    'Cédula',
    'Nombres',
    'Apellidos',
    'Email',
    'Teléfono',
    'Departamento',
    'Cargo',
    'Fecha de ingreso',
    'Frecuencia',
    'Salario',
    'Estado',
  ]
  const cfHeader = selectedDefs.map((d) => d.name)
  const header = [...baseHeader, ...cfHeader]

  const rows: (string | number | null)[][] = [header]
  for (const e of employees) {
    const cf = (e.customFields ?? {}) as Record<string, unknown>
    const cfCells = selectedDefs.map((d) => {
      const v = cf[d.code]
      if (v == null || v === '') return ''
      if (d.fieldType === 'integer') {
        const n = Number.parseInt(String(v), 10)
        return Number.isFinite(n) ? n : ''
      }
      if (d.fieldType === 'float') {
        const n = Number(String(v))
        return Number.isFinite(n) ? n : ''
      }
      return String(v)
    })
    rows.push([
      e.code,
      e.idNumber ?? '',
      e.firstName,
      e.lastName,
      e.email ?? '',
      e.phone ?? '',
      e.department ?? '',
      e.position ?? '',
      e.hireDate ?? '',
      FREQ_LABEL[e.payFrequency ?? ''] ?? e.payFrequency ?? '',
      Number(e.baseSalary ?? 0),
      e.isActive ? 'Activo' : 'Inactivo',
      ...cfCells,
    ])
  }

  const sheet = XLSX.utils.aoa_to_sheet(rows)
  // Bold the header row
  sheet['!cols'] = header.map((h) => ({ wch: Math.max(12, h.length + 2) }))
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, sheet, 'Personal')
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })

  return new Response(buffer, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="personal-${Date.now()}.xlsx"`,
      'Cache-Control': 'no-store',
    },
  })
}
