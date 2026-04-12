import type { APIRoute } from 'astro'
import * as XLSX from 'xlsx'
import type { PdfPayroll, PdfPayrollLine } from '../../../../lib/pdf/payroll-pdf'

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'
const TENANT = 'demo'

const TYPE_LABEL: Record<string, string> = {
  regular: 'Regular',
  thirteenth: 'XIII Mes',
  special: 'Especial',
}
const FREQ_LABEL: Record<string, string> = {
  biweekly: 'Quincenal',
  monthly: 'Mensual',
  weekly: 'Semanal',
}
const STATUS_LABEL: Record<string, string> = {
  created: 'Creada',
  generated: 'Generada',
  closed: 'Cerrada',
  processing: 'Procesando',
}

function num(v: string | number) {
  return Number(v)
}

export const GET: APIRoute = async ({ params, cookies, redirect }) => {
  const authCookie = cookies.get('auth')?.value
  if (!authCookie) return redirect('/login')

  const { id } = params
  const headers = { Cookie: `auth=${authCookie}`, 'X-Tenant': TENANT }

  let data: { payroll: PdfPayroll; lines: PdfPayrollLine[] }

  try {
    const res = await fetch(`${API_URL}/payroll/${id}`, { headers })
    if (res.status === 401) return redirect('/login')
    if (res.status === 404) return new Response('Planilla no encontrada', { status: 404 })
    if (!res.ok) return new Response('Error al obtener la planilla', { status: 500 })
    const json = (await res.json()) as { data: typeof data }
    data = json.data
  } catch {
    return new Response('Error de conexión con el servidor', { status: 502 })
  }

  try {
    const wb = XLSX.utils.book_new()
    const { payroll, lines } = data

    // ── Sheet 1: Resumen ──────────────────────────────────────────────────────
    const summaryRows = [
      ['PayrollSoft — Exportación de Planilla'],
      [],
      ['Planilla', payroll.name],
      ['Tipo', TYPE_LABEL[payroll.type] ?? payroll.type],
      ['Frecuencia', FREQ_LABEL[payroll.frequency] ?? payroll.frequency],
      ['Estado', STATUS_LABEL[payroll.status] ?? payroll.status],
      ['Período inicio', payroll.periodStart],
      ['Período fin', payroll.periodEnd],
      ['Fecha de pago', payroll.paymentDate ?? '—'],
      [],
      ['Total bruto', num(payroll.totalGross)],
      ['Total deducciones', num(payroll.totalDeductions)],
      ['Neto a pagar', num(payroll.totalNet)],
      ['Empleados', lines.length],
    ]

    const wsResumen = XLSX.utils.aoa_to_sheet(summaryRows)
    wsResumen['!cols'] = [{ wch: 20 }, { wch: 30 }]
    XLSX.utils.book_append_sheet(wb, wsResumen, 'Resumen')

    // ── Sheet 2: Detalle por empleado ─────────────────────────────────────────
    // Collect all concept codes that appear across all lines (ordered by first occurrence)
    const conceptCodes: string[] = []
    const conceptNames: Record<string, string> = {}
    for (const l of lines) {
      for (const c of l.line.concepts) {
        if (c.amount !== 0 && !conceptCodes.includes(c.code)) {
          conceptCodes.push(c.code)
          conceptNames[c.code] = c.name
        }
      }
    }

    const header = [
      'Ficha',
      'Nombre',
      'Apellido',
      'Departamento',
      'Puesto',
      'Bruto',
      'Deducciones',
      'Neto',
      ...conceptCodes.map((code) => `${code} — ${conceptNames[code]}`),
    ]

    const rows = lines.map((l) => {
      const conceptMap: Record<string, number> = {}
      for (const c of l.line.concepts) {
        conceptMap[c.code] = c.amount
      }
      return [
        l.employee.code,
        l.employee.firstName,
        l.employee.lastName,
        l.employee.department ?? '',
        l.employee.position ?? '',
        num(l.line.grossAmount),
        num(l.line.deductions),
        num(l.line.netAmount),
        ...conceptCodes.map((code) => conceptMap[code] ?? 0),
      ]
    })

    const wsDetalle = XLSX.utils.aoa_to_sheet([header, ...rows])

    // Column widths
    wsDetalle['!cols'] = [
      { wch: 10 }, // Ficha
      { wch: 18 }, // Nombre
      { wch: 18 }, // Apellido
      { wch: 18 }, // Departamento
      { wch: 18 }, // Puesto
      { wch: 14 }, // Bruto
      { wch: 14 }, // Deducciones
      { wch: 14 }, // Neto
      ...conceptCodes.map(() => ({ wch: 18 })),
    ]

    // Freeze first row
    wsDetalle['!freeze'] = { xSplit: 0, ySplit: 1 }

    XLSX.utils.book_append_sheet(wb, wsDetalle, 'Detalle')

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
    const filename = `planilla-${payroll.name.replace(/\s+/g, '-').toLowerCase()}.xlsx`

    return new Response(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': String(buffer.byteLength),
      },
    })
  } catch (err) {
    console.error('XLSX generation error:', err)
    return new Response('Error al generar el Excel', { status: 500 })
  }
}
