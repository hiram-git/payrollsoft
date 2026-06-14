/**
 * GET /api/treasury/runs/:id/checks-pdf
 *
 * Descarga TODOS los cheques de una corrida de pago en un solo PDF
 * (un cheque por página). Excluye cheques anulados — esos no
 * deberían imprimirse.
 *
 * Cada cheque se marca como `printed` en el API (best-effort, no
 * bloquea la descarga).
 */
import type { APIRoute } from 'astro'
import { getIdentity } from '../../../../../lib/auth'
import { renderCheckPdfBuffer } from '../../../../../lib/treasury/check-pdf-renderer'

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'

type CheckRow = {
  id: string
  checkNumber: number
  issueDate: string
  beneficiaryName: string
  beneficiaryType: string
  amount: string
  amountInWords: string
  concept: string | null
  status: string
}

export const GET: APIRoute = async ({ params, cookies, redirect, url }) => {
  const identity = getIdentity(cookies)
  if (!identity) return redirect('/login')
  const tenant = identity.tenantSlug ?? 'demo'

  const id = params.id ?? ''
  const benef = url.searchParams.get('beneficiary')
  const headers = { Cookie: `auth=${identity.raw}`, 'X-Tenant': tenant }

  const res = await fetch(`${API_URL}/treasury/runs/${id}/checks`, { headers })
  if (!res.ok) {
    return new Response('Corrida no encontrada', { status: res.status })
  }
  const { data } = (await res.json()) as { data: CheckRow[] }
  const printable = data.filter(
    (c) => c.status !== 'voided' && (!benef || c.beneficiaryType === benef)
  )

  if (printable.length === 0) {
    return new Response('No hay cheques imprimibles en esta corrida.', { status: 404 })
  }

  const buffer = await renderCheckPdfBuffer(
    printable.map((c) => ({
      checkNumber: c.checkNumber,
      issueDate: c.issueDate,
      beneficiaryName: c.beneficiaryName,
      amount: c.amount,
      amountInWords: c.amountInWords,
      concept: c.concept,
    }))
  )

  // Marcar todos como impresos (idempotente). Fire-and-forget.
  for (const c of printable) {
    fetch(`${API_URL}/treasury/checks/${c.id}/print`, {
      method: 'POST',
      headers,
    }).catch(() => {})
  }

  const filename = `cheques-${benef ?? 'corrida'}-${id.slice(0, 8)}.pdf`
  return new Response(buffer, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(buffer.byteLength),
    },
  })
}
