import type { APIRoute } from 'astro'
import {
  fetchPayrollReportData,
  parsePayrollReportFilters,
} from '../../../../../lib/reports/payroll-data'
import { renderPayrollPdfResponse } from '../../../../../lib/reports/payroll-pdf-renderer'

/**
 * Canonical "reports" route for the landscape A4 payroll PDF. Filters are
 * parsed from the query string + the active payroll-type cookie via
 * `parsePayrollReportFilters` so this route and the legacy
 * `/api/payroll/:id/pdf` stay in lock-step.
 */
export const GET: APIRoute = async ({ params, cookies, redirect, url }) => {
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

  try {
    return await renderPayrollPdfResponse(result.data)
  } catch (err) {
    console.error('PDF generation error:', err)
    return new Response('Error al generar el PDF', { status: 500 })
  }
}
