import type { APIRoute } from 'astro'
import { resolveTenantSlugFromCookie } from '../../../../../lib/tenant-slug'

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'

const isModal = (request: Request) => request.headers.get('x-sa-modal') === '1'

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * Proxy multi-acción para `/payroll/:id/line/:lineId`. El método se
 * pasa vía `_method` en el formData (compatibilidad histórica con el
 * botón Regenerate). Acepta:
 *
 *   _method=REGENERATE      → POST /payroll/:id/lines/:lineId/regenerate
 *   _method=ADD_MANUAL      → POST /payroll/:id/lines/:lineId/manual-concepts
 *   _method=DELETE_MANUAL   → DELETE /payroll/:id/lines/:lineId/manual-concepts/:code
 *
 * Dual-mode: si la request trae `X-SA-Modal: 1` (helper de modales en
 * AppLayout) responde JSON con `{ ok, redirect?, message?, error? }`.
 * Sin el header, mantiene el redirect tradicional para fallback sin JS.
 */
export const POST: APIRoute = async ({ request, cookies, params, redirect }) => {
  const authCookie = cookies.get('auth')?.value
  if (!authCookie) {
    if (isModal(request)) return jsonResponse(401, { ok: false, error: 'No autorizado.' })
    return redirect('/login')
  }
  const TENANT = resolveTenantSlugFromCookie(authCookie)

  const { id, lineId } = params
  const form = await request.formData()
  const method = form.get('_method')?.toString() ?? ''

  const headers = { Cookie: `auth=${authCookie}`, 'X-Tenant': TENANT }
  const detailUrl = `/payroll/${id}/${lineId}`

  const fail = (status: number, msg: string) => {
    if (isModal(request)) return jsonResponse(status, { ok: false, error: msg })
    return redirect(`${detailUrl}?error=${encodeURIComponent(msg)}`)
  }
  const ok = (message: string) => {
    if (isModal(request)) {
      return jsonResponse(200, { ok: true, redirect: detailUrl, message })
    }
    return redirect(`${detailUrl}?success=1`)
  }

  if (method === 'REGENERATE') {
    let res: Response
    try {
      res = await fetch(`${API_URL}/payroll/${id}/lines/${lineId}/regenerate`, {
        method: 'POST',
        headers,
      })
    } catch (e) {
      return fail(502, e instanceof Error ? e.message : 'No se pudo conectar con el servidor API')
    }
    if (res.status === 401) {
      if (isModal(request)) return jsonResponse(401, { ok: false, error: 'Sesión vencida.' })
      return redirect('/login')
    }
    if (res.ok) return ok('Línea regenerada correctamente.')
    const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string }
    return fail(res.status, data.message ?? data.error ?? `HTTP ${res.status}`)
  }

  if (method === 'ADD_MANUAL') {
    const conceptId = form.get('conceptId')?.toString() ?? ''
    const amountRaw = form.get('amount')?.toString() ?? ''
    const amount = Number(amountRaw)
    if (!conceptId) return fail(400, 'Selecciona un concepto del catálogo.')
    if (!Number.isFinite(amount) || amount <= 0) {
      return fail(400, 'El monto debe ser un número mayor a cero.')
    }
    let res: Response
    try {
      res = await fetch(`${API_URL}/payroll/${id}/lines/${lineId}/manual-concepts`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ conceptId, amount }),
      })
    } catch (e) {
      return fail(502, e instanceof Error ? e.message : 'No se pudo conectar con el servidor API')
    }
    if (res.status === 401) {
      if (isModal(request)) return jsonResponse(401, { ok: false, error: 'Sesión vencida.' })
      return redirect('/login')
    }
    if (res.ok) return ok('Concepto agregado a la línea.')
    const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string }
    return fail(res.status, data.message ?? data.error ?? `HTTP ${res.status}`)
  }

  if (method === 'DELETE_MANUAL') {
    const code = form.get('code')?.toString() ?? ''
    if (!code) return fail(400, 'Falta el código del concepto a eliminar.')
    let res: Response
    try {
      res = await fetch(
        `${API_URL}/payroll/${id}/lines/${lineId}/manual-concepts/${encodeURIComponent(code)}`,
        { method: 'DELETE', headers }
      )
    } catch (e) {
      return fail(502, e instanceof Error ? e.message : 'No se pudo conectar con el servidor API')
    }
    if (res.status === 401) {
      if (isModal(request)) return jsonResponse(401, { ok: false, error: 'Sesión vencida.' })
      return redirect('/login')
    }
    if (res.ok) return ok('Concepto eliminado de la línea.')
    const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string }
    return fail(res.status, data.message ?? data.error ?? `HTTP ${res.status}`)
  }

  return redirect(detailUrl)
}
