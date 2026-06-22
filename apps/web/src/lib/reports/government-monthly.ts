/**
 * Agregación mensual para los reportes de gobierno SIPE / SIACAP: junta TODAS
 * las planillas cerradas de un mes + año (+ tipo) y acumula por empleado los
 * conceptos relevantes (sueldo, seguro social, SIACAP), separando además lo
 * pagado en primera vs segunda quincena (según el día de la fecha de pago).
 *
 * Reusa `fetchGovernmentReportData` + `computeBuckets` para no duplicar la
 * clasificación de conceptos.
 */
import { resolveTenantSlugFromCookie } from '../tenant-slug'
import { computeBuckets, fetchGovernmentReportData } from './government-data'

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'

export type MonthlyEmployeeRow = {
  code: string
  idNumber: string | null
  firstName: string
  lastName: string
  status: string | null
  salarioMensual: number
  ss: number
  siacap: number
  quincena1: number
  quincena2: number
}

export type MonthlyAggregate = {
  rows: MonthlyEmployeeRow[]
  patronalNumber: string
  entityName: string
}

export type MonthlyFetchResult =
  | { kind: 'ok'; data: MonthlyAggregate }
  | { kind: 'unauthorized' }
  | { kind: 'error'; status: number; message: string }

type PayrollListItem = { id: string; paymentDate: string | null; status: string }

const firstToken = (s: string): string => (s ?? '').trim().split(/\s+/)[0] ?? ''

export async function fetchMonthlyGovData(
  month: number,
  year: number,
  payrollTypeId: string | null,
  authCookie: string,
  tenantSlug: string
): Promise<MonthlyFetchResult> {
  const headers = { Cookie: `auth=${authCookie}`, 'X-Tenant': tenantSlug }

  // 1) Planillas cerradas del año (y tipo); filtramos el mes por fecha de pago.
  const payrollIds: { id: string; day: number }[] = []
  try {
    for (let page = 1; page <= 50; page++) {
      const qs = new URLSearchParams({ status: 'closed', year: String(year), page: String(page) })
      if (payrollTypeId) qs.set('payrollTypeId', payrollTypeId)
      const res = await fetch(`${API_URL}/payroll?${qs}`, { headers })
      if (res.status === 401) return { kind: 'unauthorized' }
      if (!res.ok) return { kind: 'error', status: res.status, message: 'No se pudo listar planillas' }
      const json = (await res.json()) as { data?: PayrollListItem[] }
      const batch = json.data ?? []
      for (const p of batch) {
        const d = p.paymentDate ?? ''
        if (!/^\d{4}-\d{2}-\d{2}/.test(d)) continue
        if (Number(d.slice(5, 7)) !== month) continue
        payrollIds.push({ id: p.id, day: Number(d.slice(8, 10)) })
      }
      if (batch.length < 25) break
    }
  } catch {
    return { kind: 'error', status: 502, message: 'Error de conexión al listar planillas' }
  }

  // 2) Por cada planilla, acumular buckets por empleado.
  const byEmp = new Map<string, MonthlyEmployeeRow>()
  for (const { id, day } of payrollIds) {
    const result = await fetchGovernmentReportData(id, authCookie, tenantSlug)
    if (result.kind === 'unauthorized') return { kind: 'unauthorized' }
    if (result.kind !== 'ok') continue
    const half = day >= 1 && day <= 15 ? 1 : 2
    const lines = [...result.data.groups.flatMap((g) => g.lines), ...result.data.ungrouped]
    for (const { line, employee } of lines) {
      const b = computeBuckets(line.concepts)
      let row = byEmp.get(employee.id)
      if (!row) {
        row = {
          code: employee.code,
          idNumber: employee.idNumber,
          firstName: employee.firstName,
          lastName: employee.lastName,
          status: null,
          salarioMensual: 0,
          ss: 0,
          siacap: 0,
          quincena1: 0,
          quincena2: 0,
        }
        byEmp.set(employee.id, row)
      }
      row.salarioMensual += b.sueldo
      row.ss += b.ss
      row.siacap += b.siacap
      if (half === 1) row.quincena1 += b.sueldo
      else row.quincena2 += b.sueldo
    }
  }

  // 3) Datos institucionales (patronal + entidad).
  let patronalNumber = ''
  let entityName = ''
  try {
    const res = await fetch(`${API_URL}/company`, { headers })
    if (res.ok) {
      const json = (await res.json()) as {
        data?: { patronalNumber?: string | null; entityName?: string | null; companyName?: string | null }
      }
      patronalNumber = json.data?.patronalNumber ?? ''
      entityName = json.data?.entityName ?? json.data?.companyName ?? ''
    }
  } catch {
    /* degrada */
  }

  const rows = [...byEmp.values()].map((r) => ({
    ...r,
    firstName: firstToken(r.firstName),
    lastName: firstToken(r.lastName),
  }))
  rows.sort((a, b) => a.code.localeCompare(b.code))
  return { kind: 'ok', data: { rows, patronalNumber, entityName } }
}

export function monthNameEsUpper(month: number): string {
  const MESES = [
    'ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO',
    'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE',
  ]
  return MESES[month - 1] ?? ''
}
