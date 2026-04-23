import type { APIRoute } from 'astro'
import { fetchPayrollReportData } from '../../../../../lib/reports/payroll-data'
import { renderPayrollPdfResponse } from '../../../../../lib/reports/payroll-pdf-renderer'

/**
 * Canonical "reports" route for the landscape payroll PDF. The `/reports/payroll`
 * page and the payroll detail dropdown both link here.
 */
export const GET: APIRoute = async ({ params, cookies, redirect }) => {
  const authCookie = cookies.get('auth')?.value
  if (!authCookie) return redirect('/login')

  const { id } = params
  if (!id) return new Response('ID de planilla requerido', { status: 400 })

  const result = await fetchPayrollReportData(id, authCookie)
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
