/**
 * Descarga del reporte de expedientes en .xlsx. Genera un workbook
 * con una hoja por agrupación, leyendo desde el mismo endpoint
 * agregador que usa la vista web. Es lectura pura: no inventa
 * cálculos ni filtros que no estén ya en la API.
 */
import type { APIRoute } from 'astro'
import * as XLSX from 'xlsx'
import { getIdentity } from '../../../../lib/auth'

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'

type ReportData = {
  range: { from: string | null; to: string | null }
  filters: Record<string, unknown>
  total: number
  byType: { typeName: string; count: number }[]
  bySubtype: { typeName: string; subtypeName: string; count: number }[]
  byUser: { userName: string; count: number }[]
  byEmployee: {
    employeeCode: string
    firstName: string
    lastName: string
    count: number
  }[]
  byDepartamento: { departamentoName: string; count: number }[]
  byFuncion: { funcionName: string; count: number }[]
  byCargo: { cargoName: string; count: number }[]
  byMonth: { ym: string; count: number }[]
}

export const GET: APIRoute = async ({ request, cookies }) => {
  const identity = getIdentity(cookies)
  if (!identity) return new Response('Unauthorized', { status: 401 })
  const tenant = identity.tenantSlug ?? 'demo'
  const headers = { Cookie: `auth=${identity.raw}`, 'X-Tenant': tenant }

  // Reenviamos al API todos los query params tal cual — la
  // semántica de filtros es exclusiva del backend.
  const upstream = new URL(request.url)
  const apiUrl = new URL(`${API_URL}/reports/employee-files`)
  upstream.searchParams.forEach((v, k) => apiUrl.searchParams.set(k, v))

  const res = await fetch(apiUrl, { headers })
  if (!res.ok) {
    return new Response(`Error al cargar el reporte (HTTP ${res.status})`, {
      status: res.status,
    })
  }
  const data = ((await res.json()) as { data: ReportData }).data

  // ── Hojas ─────────────────────────────────────────────────────────────
  const summarySheet = XLSX.utils.json_to_sheet(
    [
      { Métrica: 'Total movimientos', Valor: data.total },
      { Métrica: 'Desde', Valor: data.range.from ?? '—' },
      { Métrica: 'Hasta', Valor: data.range.to ?? '—' },
      { Métrica: 'Tipos involucrados', Valor: data.byType.length },
      { Métrica: 'Empleados con expedientes', Valor: data.byEmployee.length },
    ],
    { header: ['Métrica', 'Valor'] }
  )

  const byTypeSheet = XLSX.utils.json_to_sheet(
    data.byType.map((r) => ({ Tipo: r.typeName, Cantidad: r.count })),
    { header: ['Tipo', 'Cantidad'] }
  )

  const bySubtypeSheet = XLSX.utils.json_to_sheet(
    data.bySubtype.map((r) => ({
      Tipo: r.typeName,
      Subtipo: r.subtypeName,
      Cantidad: r.count,
    })),
    { header: ['Tipo', 'Subtipo', 'Cantidad'] }
  )

  const byUserSheet = XLSX.utils.json_to_sheet(
    data.byUser.map((r) => ({ Usuario: r.userName, Cantidad: r.count })),
    { header: ['Usuario', 'Cantidad'] }
  )

  const byEmployeeSheet = XLSX.utils.json_to_sheet(
    data.byEmployee.map((r) => ({
      Código: r.employeeCode,
      Empleado: `${r.lastName}, ${r.firstName}`,
      Cantidad: r.count,
    })),
    { header: ['Código', 'Empleado', 'Cantidad'] }
  )

  const byDeptSheet = XLSX.utils.json_to_sheet(
    data.byDepartamento.map((r) => ({
      Departamento: r.departamentoName,
      Cantidad: r.count,
    })),
    { header: ['Departamento', 'Cantidad'] }
  )

  const byFuncionSheet = XLSX.utils.json_to_sheet(
    data.byFuncion.map((r) => ({ Función: r.funcionName, Cantidad: r.count })),
    { header: ['Función', 'Cantidad'] }
  )

  const byCargoSheet = XLSX.utils.json_to_sheet(
    data.byCargo.map((r) => ({ Cargo: r.cargoName, Cantidad: r.count })),
    { header: ['Cargo', 'Cantidad'] }
  )

  const byMonthSheet = XLSX.utils.json_to_sheet(
    data.byMonth.map((r) => ({ 'Año-Mes': r.ym, Cantidad: r.count })),
    { header: ['Año-Mes', 'Cantidad'] }
  )

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, summarySheet, 'Resumen')
  XLSX.utils.book_append_sheet(wb, byTypeSheet, 'Por tipo')
  XLSX.utils.book_append_sheet(wb, bySubtypeSheet, 'Por subtipo')
  XLSX.utils.book_append_sheet(wb, byMonthSheet, 'Por mes')
  XLSX.utils.book_append_sheet(wb, byDeptSheet, 'Por departamento')
  XLSX.utils.book_append_sheet(wb, byFuncionSheet, 'Por función')
  XLSX.utils.book_append_sheet(wb, byCargoSheet, 'Por cargo')
  XLSX.utils.book_append_sheet(wb, byUserSheet, 'Por usuario')
  XLSX.utils.book_append_sheet(wb, byEmployeeSheet, 'Por empleado')

  const buffer: Buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
  const stamp = new Date().toISOString().slice(0, 10)
  const filename = `expedientes-${stamp}.xlsx`

  return new Response(buffer as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(buffer.byteLength),
    },
  })
}
