import type { APIRoute } from 'astro'
import {
  fetchPayrollReportData,
  parsePayrollReportFilters,
} from '../../../../lib/reports/payroll-data'
import { renderPayrollPdfResponse } from '../../../../lib/reports/payroll-pdf-renderer'

/**
 * Legacy route kept so existing links keep working. Delegates to the shared
 * reports layer — the canonical path is `/api/reports/payroll/:id/pdf`.
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
