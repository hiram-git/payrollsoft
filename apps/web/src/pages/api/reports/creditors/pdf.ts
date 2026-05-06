import { renderToBuffer } from '@react-pdf/renderer'
import type { APIRoute } from 'astro'
import React from 'react'
import { getIdentity } from '../../../../lib/auth'
import {
  CreditorsPdf,
  type PdfCompany,
  type PdfCreditorsReport,
} from '../../../../lib/pdf/creditors-pdf'

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'

const MONTH_LABELS = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
]

/**
 * Devuelve el reporte mensual de acreedores en formato PDF (A4 horizontal).
 * Reusa `/reports/creditors` y `/company` del API para mantener una única
 * fuente de verdad: la lógica de filtros + agregaciones vive solo en la
 * API; este proxy se limita a maquetar.
 */
export const GET: APIRoute = async ({ request, cookies }) => {
  const identity = getIdentity(cookies)
  if (!identity) return new Response('Unauthorized', { status: 401 })

  const tenant = identity.tenantSlug ?? 'demo'
  const headers = { Cookie: `auth=${identity.raw}`, 'X-Tenant': tenant }

  const url = new URL(request.url)
  const year = url.searchParams.get('year') ?? ''
  const month = url.searchParams.get('month') ?? ''
  if (!year || !month) {
    return new Response('Faltan parámetros year/month', { status: 400 })
  }

  let report: PdfCreditorsReport
  let company: PdfCompany | null = null
  try {
    const [repRes, compRes] = await Promise.all([
      fetch(`${API_URL}/reports/creditors?year=${year}&month=${month}`, { headers }),
      fetch(`${API_URL}/company`, { headers }),
    ])
    if (!repRes.ok) {
      let detail = `HTTP ${repRes.status}`
      try {
        const body = (await repRes.json()) as { error?: string; message?: string }
        detail = body.message ?? body.error ?? detail
      } catch {
        // best-effort
      }
      return new Response(`No se pudo cargar el reporte: ${detail}`, { status: repRes.status })
    }
    const repJson = (await repRes.json()) as { data: PdfCreditorsReport }
    report = repJson.data
    if (compRes.ok) {
      const compJson = (await compRes.json()) as { data: PdfCompany }
      company = compJson.data
    }
  } catch (err) {
    return new Response(
      `No se pudo conectar al servidor: ${err instanceof Error ? err.message : String(err)}`,
      { status: 502 }
    )
  }

  let buffer: Buffer
  try {
    const element = React.createElement(CreditorsPdf, {
      report,
      company,
      generatedBy: identity ? { name: identity.name, email: identity.email } : null,
    })
    // @react-pdf/renderer's `renderToBuffer` doesn't quite line up with React 19's
    // FunctionComponentElement type; runtime is correct.
    // biome-ignore lint/suspicious/noExplicitAny: library typing gap
    buffer = await renderToBuffer(element as any)
  } catch (err) {
    return new Response(
      `Error al generar el PDF: ${err instanceof Error ? err.message : String(err)}`,
      { status: 500 }
    )
  }

  const monthLabel = MONTH_LABELS[report.month - 1] ?? String(report.month)
  const filename = `acreedores-${report.year}-${String(report.month).padStart(2, '0')}-${monthLabel}.pdf`

  return new Response(buffer as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(buffer.byteLength),
    },
  })
}
