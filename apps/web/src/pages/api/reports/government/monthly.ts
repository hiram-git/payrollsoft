import type { APIRoute } from 'astro'
import * as XLSX from 'xlsx'
import { fetchMonthlyGovData, monthNameEsUpper } from '../../../../lib/reports/government-monthly'
import { resolveTenantSlugFromCookie } from '../../../../lib/tenant-slug'

/**
 * Reportes mensuales de gobierno SIPE / SIACAP en Excel, agregando las
 * planillas cerradas del mes + año (+ tipo). Se genera desde cero (la
 * plantilla legacy venía vacía).
 */
export const GET: APIRoute = async ({ url, cookies, redirect }) => {
  const authCookie = cookies.get('auth')?.value
  if (!authCookie) return redirect('/login')
  const tenantSlug = resolveTenantSlugFromCookie(authCookie)

  const kind = url.searchParams.get('kind') === 'sipe' ? 'sipe' : 'siacap'
  const month = Number(url.searchParams.get('month'))
  const year = Number(url.searchParams.get('year'))
  const payrollTypeId = url.searchParams.get('payrollTypeId') || null
  if (!month || !year) return new Response('month y year requeridos', { status: 400 })

  const result = await fetchMonthlyGovData(month, year, payrollTypeId, authCookie, tenantSlug)
  if (result.kind === 'unauthorized') return redirect('/login')
  if (result.kind === 'error') return new Response(result.message, { status: result.status })

  const { rows, patronalNumber } = result.data
  const mesLetras = monthNameEsUpper(month)
  const money = (n: number) => Number(n.toFixed(2))

  let aoa: (string | number)[][]
  if (kind === 'sipe') {
    aoa = [
      [`SIPE MES DE ${mesLetras} ${year}`],
      [
        'N° EMPLEADO', 'CÉDULA', 'PRIMER NOMBRE', 'PRIMER APELLIDO',
        'SALARIO MENSUAL', 'SIACAP', 'SEGURO SOCIAL', 'ESTADO',
      ],
      ...rows.map((r) => [
        r.code, r.idNumber ?? '', r.firstName, r.lastName,
        money(r.salarioMensual), money(r.siacap), money(r.ss), r.status ?? '',
      ]),
    ]
  } else {
    aoa = [
      [`SIACAP MES DE ${mesLetras} ${year}`],
      [
        'N° EMPLEADO', 'N° CÉDULA', 'PRIMER NOMBRE', 'PRIMER APELLIDO', 'N° PATRONAL',
        'PRIMERA QUINCENA', 'SEGUNDA QUINCENA', 'SALARIO MENSUAL', 'APORTE 2%',
      ],
      ...rows.map((r) => [
        r.code, r.idNumber ?? '', r.firstName, r.lastName, patronalNumber,
        money(r.quincena1), money(r.quincena2), money(r.salarioMensual), money(r.siacap),
      ]),
    ]
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = (aoa[1] as string[]).map(() => ({ wch: 18 }))
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, kind === 'sipe' ? 'SIPE' : 'SIACAP')
  const buffer: Buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })

  const fileName = `listado_${kind}_${mesLetras}_${year}.xlsx`
  return new Response(buffer as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Content-Length': String(buffer.byteLength),
    },
  })
}
