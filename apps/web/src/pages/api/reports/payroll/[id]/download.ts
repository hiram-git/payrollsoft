import type { APIRoute } from 'astro'
import { getIdentity } from '../../../../../lib/auth'
import {
  fetchPayrollReportData,
  parsePayrollReportFilters,
  payrollFileSlug,
} from '../../../../../lib/reports/payroll-data'
import { renderPayrollPdfBuffer } from '../../../../../lib/reports/payroll-pdf-renderer'
import { getReportStorage } from '../../../../../lib/reports/storage'
import { resolveTenantSlugFromCookie } from '../../../../../lib/tenant-slug'

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'

type ReportState = {
  status: 'generated' | 'not_generated'
  pdfPath: string | null
  generatedAt: string | null
  generatedByName: string | null
  generatedByEmail: string | null
}

/**
 * Stream the Planilla PDF to the browser. La estrategia depende del
 * `payrollReportMode` del tenant:
 *
 *   file_storage  + pdfPath válido → leer desde R2/S3 y streamear.
 *   local_storage + pdfPath válido → leer desde disco y streamear.
 *   on_demand                      → siempre renderizar al vuelo.
 *
 * Si el objeto persistido no se encuentra (cambio de modo, archivo
 * borrado del bucket, etc.) caemos a render en vivo en lugar de
 * romper la descarga — el usuario igual recibe su PDF.
 */
export const GET: APIRoute = async ({ params, cookies, url, redirect }) => {
  const authCookie = cookies.get('auth')?.value
  if (!authCookie) return redirect('/login')
  const TENANT = resolveTenantSlugFromCookie(authCookie)
  const identity = getIdentity(cookies)

  const { id } = params
  if (!id) return new Response('ID de planilla requerido', { status: 400 })

  const headers = { Cookie: `auth=${authCookie}`, 'X-Tenant': TENANT }

  const [stateRes, companyRes] = await Promise.all([
    fetch(`${API_URL}/payroll/${id}/report`, { headers }),
    fetch(`${API_URL}/company`, { headers }),
  ])
  if (stateRes.status === 401) return redirect('/login')
  if (stateRes.status === 404) return new Response('Planilla no encontrada', { status: 404 })
  if (!stateRes.ok) return new Response('Error al consultar el estado del reporte', { status: 500 })

  const stateJson = (await stateRes.json()) as { data: ReportState }
  const state = stateJson.data

  let payrollReportMode: string | null = null
  if (companyRes.ok) {
    const cj = (await companyRes.json()) as {
      data: { payrollReportMode?: string | null } | null
    }
    payrollReportMode = cj.data?.payrollReportMode ?? null
  }

  // Try the stored object first. Solo usamos el storage si el modo lo
  // soporta y el pdfPath no es una ruta local-legacy absoluta (`/tmp/...`).
  let pdfBytes: Uint8Array | null = null
  if (state.pdfPath && !state.pdfPath.startsWith('/')) {
    const storage = getReportStorage(payrollReportMode)
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
      // If the row was never explicitly generated (typical in on_demand
      // mode where the user hits Download directly), fall back to the
      // current viewer so the footer still attributes the PDF.
      pdfBytes = await renderPayrollPdfBuffer({
        ...result.data,
        generatedBy: {
          name: state.generatedByName ?? identity?.name ?? null,
          email: state.generatedByEmail ?? identity?.email ?? null,
        },
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
