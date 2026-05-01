import type { APIRoute } from 'astro'
import { sendComprobanteEmails } from '../../../../../../../lib/reports/comprobante-mailer'

/**
 * Send a single employee's comprobante PDF by email. The heavy lifting
 * (fetching the payroll, rendering the PDF, dispatching via SMTP) is
 * shared with the bulk endpoint — we just pin the line id so only one
 * employee is touched.
 *
 * Response shape mirrors the bulk endpoint, so the UI can use a single
 * progress / outcome panel for both flows.
 */
export const POST: APIRoute = async ({ params, cookies }) => {
  const authCookie = cookies.get('auth')?.value
  if (!authCookie) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const { id, lineId } = params
  if (!id || !lineId) {
    return new Response(JSON.stringify({ error: 'missing_params' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const result = await sendComprobanteEmails(id, authCookie, [lineId])

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
        message: 'La planilla debe estar generada o cerrada para enviar el comprobante.',
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

  // Single-line target: the line either matched or it didn't exist.
  const outcome = result.outcomes[0]
  if (!outcome) {
    return new Response(JSON.stringify({ error: 'line_not_found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  if (outcome.status === 'skipped_no_email') {
    return new Response(
      JSON.stringify({
        error: 'no_email',
        message: 'El empleado no tiene correo electrónico registrado.',
        data: outcome,
      }),
      { status: 422, headers: { 'Content-Type': 'application/json' } }
    )
  }
  if (outcome.status === 'failed') {
    return new Response(
      JSON.stringify({ error: 'send_failed', message: outcome.error, data: outcome }),
      { status: 502, headers: { 'Content-Type': 'application/json' } }
    )
  }

  return new Response(JSON.stringify({ success: true, data: outcome }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}
