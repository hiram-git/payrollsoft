import type { APIRoute } from 'astro'
import {
  fetchPayrollReportData,
  parsePayrollReportFilters,
} from '../../../../../lib/reports/payroll-data'
import { renderPayrollPdfBuffer } from '../../../../../lib/reports/payroll-pdf-renderer'
import { getReportStorage, payrollReportKey } from '../../../../../lib/reports/storage'

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'
const TENANT = 'demo'

type CompanyConfigData = { payrollReportMode?: string | null } | null

/**
 * Render the Planilla PDF and reconcile the payroll_reports row with the
 * outcome. The persistence strategy is dictated entirely by the tenant's
 * `company_config.payroll_report_mode`:
 *
 *   on_demand    → render the bytes (validates the report can be produced
 *                   without errors), discard them, mark the row as
 *                   generated. Future downloads re-render live.
 *   file_storage → render, upload to R2 under a tenant-scoped key, store
 *                   the key as `pdf_path`. Future downloads stream the
 *                   stored object instantly.
 *
 * Switching modes mid-life is safe — the row's status stays correct
 * regardless, and the download endpoint falls back to live rendering
 * whenever it can't read the stored object.
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

  // The tenant's mode is part of `result.data.company` already (it's
  // exposed by the company config endpoint), so no extra round-trip is
  // needed to know which strategy to apply.
  const company = result.data.company as CompanyConfigData
  const mode = company?.payrollReportMode ?? 'on_demand'

  let pdfBytes: Uint8Array
  try {
    pdfBytes = await renderPayrollPdfBuffer(result.data)
  } catch (err) {
    console.error('Payroll PDF render error:', err)
    return new Response('Error al renderizar el PDF', { status: 500 })
  }

  let pdfPath: string | null = null
  const storage = getReportStorage(mode)
  if (storage) {
    try {
      const key = payrollReportKey(id, TENANT)
      pdfPath = await storage.put({ key, bytes: pdfBytes, contentType: 'application/pdf' })
    } catch (err) {
      console.error('Payroll PDF storage upload error:', err)
      return new Response(
        `No se pudo guardar el PDF en el almacenamiento (${storage.driver}). Verifica las credenciales o cambia el modo a "on_demand".`,
        { status: 500 }
      )
    }
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
