import type { APIRoute } from 'astro'
import {
  fetchPayrollReportData,
  parsePayrollReportFilters,
} from '../../../../../lib/reports/payroll-data'
import { renderPayrollPdfBuffer } from '../../../../../lib/reports/payroll-pdf-renderer'
import { writePayrollReport } from '../../../../../lib/reports/payroll-report-storage'

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'
const TENANT = 'demo'

/**
 * Renders the Planilla PDF, persists it on the local filesystem and tells
 * the API to flip the payroll_reports row to `generated`. This is the only
 * path that writes PDFs to disk — the download endpoint just streams
 * whatever path the API returns, so generate + state are always consistent.
 */
export const POST: APIRoute = async ({ params, cookies, url, redirect }) => {
  const authCookie = cookies.get('auth')?.value
  if (!authCookie) return redirect('/login')

  const { id } = params
  if (!id) return new Response('ID de planilla requerido', { status: 400 })

  const filters = parsePayrollReportFilters(
    url.searchParams,
    cookies.get('payroll.activeTypeId')?.value
  )

  const result = await fetchPayrollReportData(id, authCookie, filters)
  if (result.kind === 'unauthorized') return redirect('/login')
  if (result.kind === 'not-found') return new Response('Planilla no encontrada', { status: 404 })
  if (result.kind === 'error') return new Response(result.message, { status: result.status })

  let pdfBytes: Uint8Array
  try {
    pdfBytes = await renderPayrollPdfBuffer(result.data)
  } catch (err) {
    console.error('Payroll PDF render error:', err)
    return new Response('Error al renderizar el PDF', { status: 500 })
  }

  let pdfPath: string
  try {
    pdfPath = await writePayrollReport(id, pdfBytes, TENANT)
  } catch (err) {
    console.error('Payroll PDF write error:', err)
    return new Response('Error al guardar el PDF en disco', { status: 500 })
  }

  const apiRes = await fetch(`${API_URL}/payroll/${id}/report`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `auth=${authCookie}`,
      'X-Tenant': TENANT,
    },
    body: JSON.stringify({ pdfPath }),
  })
  if (apiRes.status === 401) return redirect('/login')
  if (!apiRes.ok) {
    const text = await apiRes.text().catch(() => '')
    console.error('Payroll report state update failed:', apiRes.status, text)
    return new Response('Error al persistir el estado del reporte', { status: 500 })
  }

  const json = (await apiRes.json()) as {
    data: { status: string; pdfPath: string | null; generatedAt: string | null }
  }
  return new Response(JSON.stringify({ success: true, data: json.data }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}
