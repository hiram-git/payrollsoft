/**
 * Genera un archivo de banco / contraloría y lo devuelve como descarga en una
 * sola respuesta.
 *
 *   POST /api/treasury/files/generate   (multipart/form-data o urlencoded)
 *     format        banco_nacional | banco_general | bloqueo_quincenal | bloqueo_mensual
 *     runId         (formatos por planilla)
 *     payrollId     (formatos por planilla)
 *     sourceBankId  (banco_nacional | banco_general)
 *     description   (opcional)
 *     month, year   (bloqueo_mensual)
 *
 * Llama al API para generar el batch y luego reenvía el contenido con sus
 * cabeceras (preserva los bytes Latin-1 de Banco Nacional). En error, redirige
 * a `_redirect` con un flash.
 */
import type { APIRoute } from 'astro'
import { getIdentity } from '../../../../lib/auth'

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'

function flashUrl(base: string, flash: string, msg?: string): string {
  const u = new URL(base, 'http://placeholder')
  u.searchParams.set('flash', flash)
  if (msg) u.searchParams.set('msg', msg)
  return u.pathname + u.search
}

export const POST: APIRoute = async ({ request, cookies }) => {
  const identity = getIdentity(cookies)
  if (!identity) return new Response('Unauthorized', { status: 401 })
  const tenant = identity.tenantSlug ?? 'demo'
  const jsonHeaders = {
    Cookie: `auth=${identity.raw}`,
    'X-Tenant': tenant,
    'Content-Type': 'application/json',
  }
  const dlHeaders = { Cookie: `auth=${identity.raw}`, 'X-Tenant': tenant }

  const form = Object.fromEntries(await request.formData())
  const format = String(form.format ?? '')
  const redirectTo = String(form._redirect ?? '/treasury')
  const fail = (msg: string) =>
    Response.redirect(new URL(flashUrl(redirectTo, 'error', msg), request.url), 303)

  let genPath: string
  let payload: Record<string, unknown>
  if (format === 'bloqueo_mensual') {
    genPath = '/treasury/bloqueo-mensual'
    payload = { month: Number(form.month), year: Number(form.year) }
  } else if (
    format === 'banco_nacional' ||
    format === 'banco_general' ||
    format === 'bloqueo_quincenal'
  ) {
    const runId = String(form.runId ?? '')
    if (!runId) return fail('Falta la generación de pagos.')
    genPath = `/treasury/runs/${runId}/files`
    const beneficiary = String(form.beneficiary ?? 'employees') === 'creditors' ? 'creditors' : 'employees'
    payload = {
      format,
      payrollId: String(form.payrollId ?? ''),
      beneficiary,
      month: form.month ? Number(form.month) : undefined,
      year: form.year ? Number(form.year) : undefined,
      sourceBankId: form.sourceBankId ? String(form.sourceBankId) : null,
      description: form.description ? String(form.description) : null,
    }
  } else {
    return fail('Formato inválido.')
  }

  const genRes = await fetch(`${API_URL}${genPath}`, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify(payload),
  })
  const genText = await genRes.text()
  let genJson: {
    success?: boolean
    error?: string
    data?: { batchId?: string; fileName?: string }
  } = {}
  try {
    genJson = genText ? JSON.parse(genText) : {}
  } catch {
    /* texto plano */
  }
  if (!genRes.ok || genJson.success === false || !genJson.data?.batchId) {
    return fail(genJson.error ?? `No se pudo generar el archivo (HTTP ${genRes.status}).`)
  }

  const dlRes = await fetch(`${API_URL}/treasury/ach/${genJson.data.batchId}/download`, {
    headers: dlHeaders,
  })
  if (!dlRes.ok) return fail('El archivo se generó pero no se pudo descargar.')
  const buffer = await dlRes.arrayBuffer()
  const fileName = genJson.data.fileName ?? 'archivo.txt'
  return new Response(buffer, {
    status: 200,
    headers: {
      'Content-Type': dlRes.headers.get('Content-Type') ?? 'text/plain',
      'Content-Disposition':
        dlRes.headers.get('Content-Disposition') ?? `attachment; filename="${fileName}"`,
      'Content-Length': String(buffer.byteLength),
    },
  })
}
