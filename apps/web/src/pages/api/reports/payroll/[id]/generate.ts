import type { APIRoute } from 'astro'
import {
  fetchPayrollReportData,
  parsePayrollReportFilters,
} from '../../../../../lib/reports/payroll-data'
import { renderPayrollPdfBuffer } from '../../../../../lib/reports/payroll-pdf-renderer'
import { getReportStorage, payrollReportKey } from '../../../../../lib/reports/storage'
import { resolveTenantSlugFromCookie } from '../../../../../lib/tenant-slug'

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'

type CompanyConfigData = { payrollReportMode?: string | null } | null

/**
 * Decode the auth JWT (server-side, payload only) so we can stamp the
 * generator's name + email into the PDF footer at render time. The
 * payload is already validated upstream by every protected route, so
 * we trust the same fields the AppLayout reads to populate the topbar.
 */
function decodeJwtPayload(token: string): { name?: string; email?: string } | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const json = Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString(
      'utf8'
    )
    return JSON.parse(json) as { name?: string; email?: string }
  } catch {
    return null
  }
}

/**
 * Render the Planilla PDF and reconcile the payroll_reports row with the
 * outcome. La estrategia de persistencia depende del
 * `company_config.payroll_report_mode` del tenant:
 *
 *   on_demand     → renderiza, descarta los bytes y marca la fila como
 *                    generada. Las descargas posteriores re-renderizan.
 *   file_storage  → renderiza, sube a R2/S3 bajo una key tenant-scoped
 *                    y guarda esa key en `pdf_path`. Descargas siguientes
 *                    streamean el objeto guardado.
 *   local_storage → idéntico al anterior pero el almacenamiento es disco
 *                    bajo `STORAGE_DIR`. Útil para deploys on-prem.
 *
 * Cambiar de modo en caliente es seguro — el estado de la fila queda
 * consistente y el endpoint de descarga cae a render en vivo siempre que
 * no logre leer el objeto persistido.
 */
export const POST: APIRoute = async ({ params, cookies, url, redirect }) => {
  const authCookie = cookies.get('auth')?.value
  if (!authCookie) return redirect('/login')
  const TENANT = resolveTenantSlugFromCookie(authCookie)

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

  // Stamp the current user as the report's generator so the footer
  // already shows the right name even on the first render (file_storage
  // mode persists this rendering verbatim).
  const jwt = decodeJwtPayload(authCookie)
  const generatedBy = jwt ? { name: jwt.name ?? null, email: jwt.email ?? null } : null

  let pdfBytes: Uint8Array
  try {
    pdfBytes = await renderPayrollPdfBuffer({ ...result.data, generatedBy })
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
