import type { APIRoute } from 'astro'
import { sendComprobanteEmails } from '../../../../../lib/reports/comprobante-mailer'

/**
 * Bulk-send the comprobante PDF to every employee on the payroll.
 *
 * Always renders fresh PDFs (the comprobante is meant to reflect the
 * latest line state) and emails them via the tenant's SMTP config.
 * The response carries a per-employee summary so the operator knows
 * exactly who received their payslip and which addresses were missing
 * or failed.
 *
 * Returns:
 *   200 { sent, skipped, failed, outcomes }     — even with partial failures
 *   401                                         — auth missing
 *   404                                         — payroll not found
 *   409 { error, status }                       — payroll in `created` / `processing`
 *   503 { error: 'mail_not_configured' }        — tenant SMTP fields empty
 *   500 { error }                               — transport / fetch failure
 */
export const POST: APIRoute = async ({ params, request, cookies }) => {
  const authCookie = cookies.get('auth')?.value
  if (!authCookie) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const { id } = params
  if (!id) {
    return new Response(JSON.stringify({ error: 'missing_payroll_id' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Optional body filter: { lineIds: ['…','…'] } — when omitted/empty
  // we email everyone on the payroll.
  let lineIds: string[] | null = null
  try {
    const text = await request.text()
    if (text) {
      const parsed = JSON.parse(text) as { lineIds?: unknown }
      if (Array.isArray(parsed.lineIds)) {
        const ids = parsed.lineIds.filter((v): v is string => typeof v === 'string' && v.length > 0)
        if (ids.length > 0) lineIds = ids
      }
    }
  } catch {
    // Non-JSON body → treat as "send to everyone"; mirrors the empty-body case.
  }

  const result = await sendComprobanteEmails(id, authCookie, lineIds)

  if (result.kind === 'unauthorized') {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  if (result.kind === 'not-found') {
    return new Response(JSON.stringify({ error: 'not_found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  if (result.kind === 'bad-status') {
    return new Response(
      JSON.stringify({
        error: 'bad_status',
        status: result.status,
        message: 'La planilla debe estar generada o cerrada antes de enviar comprobantes.',
      }),
      { status: 409, headers: { 'Content-Type': 'application/json' } }
    )
  }
  if (result.kind === 'mail-not-configured') {
    return new Response(
      JSON.stringify({
        error: 'mail_not_configured',
        message:
          'El SMTP de la empresa no está configurado. Completa /config/company → Servidor SMTP antes de enviar comprobantes.',
      }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    )
  }
  if (result.kind === 'error') {
    return new Response(JSON.stringify({ error: 'server_error', message: result.message }), {
      status: result.status ?? 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const summary = {
    sent: result.outcomes.filter((o) => o.status === 'sent').length,
    skipped: result.outcomes.filter((o) => o.status === 'skipped_no_email').length,
    failed: result.outcomes.filter((o) => o.status === 'failed').length,
    outcomes: result.outcomes,
  }

  return new Response(JSON.stringify({ success: true, data: summary }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}
