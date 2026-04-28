import type { APIRoute } from 'astro'
import {
  fetchPayrollReportData,
  parsePayrollReportFilters,
  payrollFileSlug,
} from '../../../../../lib/reports/payroll-data'
import { renderPayrollPdfBuffer } from '../../../../../lib/reports/payroll-pdf-renderer'
import { getReportStorage } from '../../../../../lib/reports/storage'

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'
const TENANT = 'demo'

type ReportState = {
  status: 'generated' | 'not_generated'
  pdfPath: string | null
  generatedAt: string | null
  generatedByName: string | null
  generatedByEmail: string | null
}

/**
 * Stream the Planilla PDF to the browser. Strategy is dictated by the
 * tenant's `payrollReportMode`:
 *
 *   file_storage + valid pdfPath → fetch from R2 and stream (instant).
 *   on_demand                    → re-render live and stream.
 *
 * If the stored object is missing (e.g. the tenant just switched modes,
 * or the row carries a legacy local /tmp/... path) we fall back to a
 * live render instead of failing — the user still gets their PDF.
 */
export const GET: APIRoute = async ({ params, cookies, url, redirect }) => {
  const authCookie = cookies.get('auth')?.value
  if (!authCookie) return redirect('/login')

  const { id } = params
  if (!id) return new Response('ID de planilla requerido', { status: 400 })

  const headers = { Cookie: `auth=${authCookie}`, 'X-Tenant': TENANT }

  const stateRes = await fetch(`${API_URL}/payroll/${id}/report`, { headers })
  if (stateRes.status === 401) return redirect('/login')
  if (stateRes.status === 404) return new Response('Planilla no encontrada', { status: 404 })
  if (!stateRes.ok) return new Response('Error al consultar el estado del reporte', { status: 500 })

  const stateJson = (await stateRes.json()) as { data: ReportState }
  const state = stateJson.data
  if (state.status !== 'generated') {
    return new Response('El reporte no ha sido generado', { status: 409 })
  }

  // Try the stored object first. We only treat keys that *don't* look like
  // legacy local filesystem paths (i.e. don't start with '/') as
  // R2-addressable; anything else is silently ignored and the download
  // falls through to a live render.
  let pdfBytes: Uint8Array | null = null
  if (state.pdfPath && !state.pdfPath.startsWith('/')) {
    const storage = getReportStorage('file_storage')
    if (storage) {
      try {
        pdfBytes = await storage.get(state.pdfPath)
      } catch (err) {
        console.error('Payroll PDF storage read error:', err)
        pdfBytes = null
      }
    }
  }

  // Fallback: render the report live. Same fetch pipeline as `generate`,
  // honouring whatever filters the user has on screen.
  let payrollName = id
  if (!pdfBytes) {
    const filters = parsePayrollReportFilters(
      url.searchParams,
      cookies.get('payroll.activeTypeId')?.value
    )
    const result = await fetchPayrollReportData(id, authCookie, filters)
    if (result.kind === 'unauthorized') return redirect('/login')
    if (result.kind === 'not-found') return new Response('Planilla no encontrada', { status: 404 })
    if (result.kind === 'error') return new Response(result.message, { status: result.status })

    payrollName = result.data.payroll.name
    try {
      // Live re-render preserves the original generator's identity in
      // the footer so the report still answers "who produced this".
      pdfBytes = await renderPayrollPdfBuffer({
        ...result.data,
        generatedBy: { name: state.generatedByName, email: state.generatedByEmail },
      })
    } catch (err) {
      console.error('Payroll PDF render error:', err)
      return new Response('Error al renderizar el PDF', { status: 500 })
    }
  } else {
    // Best-effort fetch of the payroll name for a friendly filename; fall
    // back to the id if the lookup fails — the download still works.
    try {
      const res = await fetch(`${API_URL}/payroll/${id}?linesLimit=1`, { headers })
      if (res.ok) {
        const json = (await res.json()) as { data: { payroll: { name: string } } }
        payrollName = json.data.payroll.name
      }
    } catch {
      // keep payrollName = id
    }
  }

  const filename = `planilla-${payrollFileSlug(payrollName)}.pdf`
  // BodyInit accepts Uint8Array at runtime; the cast silences a TS lib
  // mismatch between @types/node and the web `Response` constructor.
  return new Response(pdfBytes as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(pdfBytes.byteLength),
    },
  })
}
