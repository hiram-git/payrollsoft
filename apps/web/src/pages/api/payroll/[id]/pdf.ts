import { renderToBuffer } from '@react-pdf/renderer'
import type { APIRoute } from 'astro'
import React from 'react'
import { PayrollPdf } from '../../../../lib/pdf/payroll-pdf'

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'
const TENANT = 'demo'

export const GET: APIRoute = async ({ params, cookies, redirect }) => {
  const authCookie = cookies.get('auth')?.value
  if (!authCookie) return redirect('/login')

  const { id } = params
  const headers = { Cookie: `auth=${authCookie}`, 'X-Tenant': TENANT }

  // Fetch payroll data
  let data: {
    payroll: Parameters<typeof PayrollPdf>[0]['payroll']
    lines: Parameters<typeof PayrollPdf>[0]['lines']
  }

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

  // Render PDF buffer
  try {
    const buffer = await renderToBuffer(
      React.createElement(PayrollPdf, { payroll: data.payroll, lines: data.lines })
    )

    const filename = `planilla-${data.payroll.name.replace(/\s+/g, '-').toLowerCase()}.pdf`

    return new Response(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': String(buffer.byteLength),
      },
    })
  } catch (err) {
    console.error('PDF generation error:', err)
    return new Response('Error al generar el PDF', { status: 500 })
  }
}
