import { renderToBuffer } from '@react-pdf/renderer'
import type { APIRoute } from 'astro'
import React from 'react'
import { StubPdf } from '../../../../../../lib/pdf/stub-pdf'

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'
const TENANT = 'demo'

export const GET: APIRoute = async ({ params, cookies, redirect }) => {
  const authCookie = cookies.get('auth')?.value
  if (!authCookie) return redirect('/login')

  const { id, lineId } = params
  const headers = { Cookie: `auth=${authCookie}`, 'X-Tenant': TENANT }

  let payrollData: {
    payroll: Parameters<typeof StubPdf>[0]['payroll']
    lines: Array<{
      line: {
        id: string
        grossAmount: string
        deductions: string
        netAmount: string
        concepts: Parameters<typeof StubPdf>[0]['line']['concepts']
      }
      employee: Parameters<typeof StubPdf>[0]['employee']
    }>
  }

  try {
    const res = await fetch(`${API_URL}/payroll/${id}`, { headers })
    if (res.status === 401) return redirect('/login')
    if (res.status === 404) return new Response('Planilla no encontrada', { status: 404 })
    if (!res.ok) return new Response('Error al obtener la planilla', { status: 500 })
    const json = (await res.json()) as { data: typeof payrollData }
    payrollData = json.data
  } catch {
    return new Response('Error de conexión con el servidor', { status: 502 })
  }

  const lineEntry = payrollData.lines.find((l) => l.line.id === lineId)
  if (!lineEntry) return new Response('Línea de planilla no encontrada', { status: 404 })

  try {
    const buffer = await renderToBuffer(
      React.createElement(StubPdf, {
        payroll: payrollData.payroll,
        employee: lineEntry.employee,
        line: lineEntry.line,
      })
    )

    const empName = `${lineEntry.employee.firstName}-${lineEntry.employee.lastName}`
      .replace(/\s+/g, '-')
      .toLowerCase()
    const filename = `comprobante-${empName}-${payrollData.payroll.periodStart}.pdf`

    return new Response(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': String(buffer.byteLength),
      },
    })
  } catch (err) {
    console.error('Stub PDF generation error:', err)
    return new Response('Error al generar el comprobante', { status: 500 })
  }
}
