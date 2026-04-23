import { readFile } from 'node:fs/promises'
import type { APIRoute } from 'astro'
import { payrollFileSlug } from '../../../../../lib/reports/payroll-data'
import { payrollReportExists } from '../../../../../lib/reports/payroll-report-storage'

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'
const TENANT = 'demo'

type ReportState = {
  status: 'generated' | 'not_generated'
  pdfPath: string | null
  generatedAt: string | null
}

type PayrollMeta = { name: string } | null

/**
 * Streams the stored PDF for a payroll. Reads the report state from the API
 * (so we honour the `generated` status) and then loads the file from the
 * shared local filesystem. Returns 409 if the user asked for a download
 * before the report has ever been generated.
 */
export const GET: APIRoute = async ({ params, cookies, redirect }) => {
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
  if (state.status !== 'generated' || !state.pdfPath) {
    return new Response('El reporte no ha sido generado', { status: 409 })
  }

  if (!(await payrollReportExists(state.pdfPath))) {
    return new Response('El archivo PDF no se encuentra en disco', { status: 410 })
  }

  // Best-effort fetch of the payroll name for a friendly filename; fall back
  // to the id if the lookup fails so the download still works.
  let payrollMeta: PayrollMeta = null
  try {
    const res = await fetch(`${API_URL}/payroll/${id}?linesLimit=1`, { headers })
    if (res.ok) {
      const json = (await res.json()) as { data: { payroll: { name: string } } }
      payrollMeta = { name: json.data.payroll.name }
    }
  } catch {
    payrollMeta = null
  }

  const filename = `planilla-${payrollFileSlug(payrollMeta?.name ?? id)}.pdf`

  const bytes = await readFile(state.pdfPath)
  return new Response(bytes, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(bytes.byteLength),
    },
  })
}
