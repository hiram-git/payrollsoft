import type { APIRoute } from 'astro'
import * as XLSX from 'xlsx'
import { getIdentity } from '../../../../lib/auth'
import {
  formatCustomFieldValue,
  loadCreditorsExtras,
} from '../../../../lib/reports/creditors-extra-columns'

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'

type DetailRow = {
  creditorId: string
  creditorCode: string
  creditorName: string
  conceptCode: string
  amount: string
  payrollName: string
  periodStart: string
  periodEnd: string
  employeeId: string
  employeeCode: string
  firstName: string
  lastName: string
}
type CreditorBucket = {
  creditorCode: string
  creditorName: string
  total: string
  employeeCount: number
  installmentCount: number
  details: DetailRow[]
}
type ReportData = {
  year: number
  month: number
  rangeFrom: string
  rangeTo: string
  grandTotal: string
  creditorCount: number
  installmentCount: number
  creditors: CreditorBucket[]
}

const MONTH_LABELS = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
]

/**
 * Genera un archivo .xlsx con dos hojas:
 *   - "Resumen" — un acreedor por fila con su total mensual.
 *   - "Detalle" — una fila por descuento, útil para conciliar contra
 *     planillas individuales.
 *
 * Es lectura del mismo endpoint `/reports/creditors`, así que la lógica
 * de filtros + cálculos vive solo en la API y este proxy se limita a
 * dar formato.
 */
export const GET: APIRoute = async ({ request, cookies }) => {
  const identity = getIdentity(cookies)
  if (!identity) return new Response('Unauthorized', { status: 401 })

  const tenant = identity.tenantSlug ?? 'demo'
  const headers = { Cookie: `auth=${identity.raw}`, 'X-Tenant': tenant }

  const url = new URL(request.url)
  const year = url.searchParams.get('year') ?? ''
  const month = url.searchParams.get('month') ?? ''
  if (!year || !month) {
    return new Response('Faltan parámetros year/month', { status: 400 })
  }

  let res: Response
  try {
    res = await fetch(`${API_URL}/reports/creditors?year=${year}&month=${month}`, {
      headers,
    })
  } catch (err) {
    return new Response(
      `No se pudo conectar al servidor: ${err instanceof Error ? err.message : String(err)}`,
      { status: 502 }
    )
  }
  if (!res.ok) {
    let detail = `HTTP ${res.status}`
    try {
      const body = (await res.json()) as { error?: string; message?: string }
      detail = body.message ?? body.error ?? detail
    } catch {
      // best-effort
    }
    return new Response(`No se pudo cargar el reporte: ${detail}`, { status: res.status })
  }

  const json = (await res.json()) as { data: ReportData }
  const data = json.data
  const monthLabel = MONTH_LABELS[data.month - 1] ?? String(data.month)

  // Campos adicionales marcados para el reporte de acreedores. Cada
  // entrada activa se transforma en una columna extra en la hoja
  // "Detalle"; la hoja "Resumen" agrega por acreedor y no se ve afectada.
  const { defs: extraDefs, customFieldsByEmployee } = await loadCreditorsExtras(API_URL, headers)

  // ── Hoja "Resumen" ──────────────────────────────────────────────────────
  const summaryRows = data.creditors.map((c) => ({
    Código: c.creditorCode,
    Acreedor: c.creditorName,
    Empleados: c.employeeCount,
    Cuotas: c.installmentCount,
    Total: Number(c.total),
  }))
  summaryRows.push({
    Código: '',
    Acreedor: 'TOTAL GENERAL',
    Empleados: data.creditors.reduce((s, c) => s + c.employeeCount, 0),
    Cuotas: data.installmentCount,
    Total: Number(data.grandTotal),
  })
  const summarySheet = XLSX.utils.json_to_sheet(summaryRows, {
    header: ['Código', 'Acreedor', 'Empleados', 'Cuotas', 'Total'],
  })
  summarySheet['!cols'] = [{ wch: 14 }, { wch: 36 }, { wch: 10 }, { wch: 8 }, { wch: 14 }]

  // ── Hoja "Detalle" ──────────────────────────────────────────────────────
  const detailRows = data.creditors.flatMap((c) =>
    c.details.map((d) => {
      const cf = customFieldsByEmployee.get(d.employeeId) ?? {}
      const extras: Record<string, string | number> = {}
      for (const def of extraDefs) {
        extras[def.name] = formatCustomFieldValue(def, cf[def.code])
      }
      return {
        Acreedor: c.creditorName,
        Código: c.creditorCode,
        Concepto: d.conceptCode,
        'Cód. Empleado': d.employeeCode,
        Empleado: `${d.lastName}, ${d.firstName}`,
        Planilla: d.payrollName,
        'Período inicio': d.periodStart,
        'Período fin': d.periodEnd,
        ...extras,
        Monto: Number(d.amount),
      }
    })
  )
  const detailHeader = [
    'Acreedor',
    'Código',
    'Concepto',
    'Cód. Empleado',
    'Empleado',
    'Planilla',
    'Período inicio',
    'Período fin',
    ...extraDefs.map((d) => d.name),
    'Monto',
  ]
  const detailSheet = XLSX.utils.json_to_sheet(detailRows, { header: detailHeader })
  detailSheet['!cols'] = detailHeader.map((h) => ({ wch: Math.max(12, h.length + 2) }))

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, summarySheet, 'Resumen')
  XLSX.utils.book_append_sheet(wb, detailSheet, 'Detalle')

  const buffer: Buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
  const filename = `acreedores-${data.year}-${String(data.month).padStart(2, '0')}-${monthLabel.toLowerCase()}.xlsx`

  return new Response(buffer as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(buffer.byteLength),
    },
  })
}
