/**
 * GET /api/treasury/checks/:id/pdf
 *
 * Renderiza el cheque a PDF y lo devuelve como descarga. Al servir
 * el archivo marca el cheque como `printed` en el API (idempotente —
 * si ya estaba impreso no pasa nada).
 */
import type { APIRoute } from 'astro'
import { getIdentity } from '../../../../../lib/auth'
import { renderCheckPdfBuffer } from '../../../../../lib/treasury/check-pdf-renderer'

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'

export const GET: APIRoute = async ({ params, cookies, redirect }) => {
  const identity = getIdentity(cookies)
  if (!identity) return redirect('/login')
  const tenant = identity.tenantSlug ?? 'demo'

  const id = params.id ?? ''
  const headers = { Cookie: `auth=${identity.raw}`, 'X-Tenant': tenant }

  const res = await fetch(`${API_URL}/treasury/checks/${id}`, { headers })
  if (!res.ok) {
    return new Response('Cheque no encontrado', { status: res.status })
  }
  const { data } = (await res.json()) as {
    data: {
      check: {
        checkNumber: number
        issueDate: string
        beneficiaryName: string
        amount: string
        amountInWords: string
        concept: string | null
      }
      checkbook: { accountNumber: string | null } | null
      bankName: string | null
    }
  }

  const buffer = await renderCheckPdfBuffer([
    {
      checkNumber: data.check.checkNumber,
      issueDate: data.check.issueDate,
      beneficiaryName: data.check.beneficiaryName,
      amount: data.check.amount,
      amountInWords: data.check.amountInWords,
      concept: data.check.concept,
      bankName: data.bankName ?? undefined,
      accountNumber: data.checkbook?.accountNumber ?? undefined,
    },
  ])

  // Marcar como impreso (idempotente). No bloquear la descarga si falla.
  fetch(`${API_URL}/treasury/checks/${id}/print`, { method: 'POST', headers }).catch(() => {})

  const filename = `cheque-${String(data.check.checkNumber).padStart(7, '0')}.pdf`
  return new Response(buffer, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(buffer.byteLength),
    },
  })
}
