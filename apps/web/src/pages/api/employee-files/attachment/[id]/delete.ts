/**
 * Borra un adjunto individual del expediente. Se invoca con
 * `fetch(..., { method: 'POST' })` desde la vista de edición.
 *
 * El backend tiene DELETE; mantenemos el método HTTP del cliente
 * como POST porque los formularios HTML no soportan DELETE nativo
 * sin un override, y este endpoint vive en una página, no en una
 * API embebida en un form.
 */
import type { APIRoute } from 'astro'
import { getIdentity } from '../../../../../lib/auth'

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export const POST: APIRoute = async ({ params, cookies }) => {
  const identity = getIdentity(cookies)
  if (!identity) return jsonResponse(401, { ok: false, error: 'No autorizado.' })
  const tenant = identity.tenantSlug ?? 'demo'
  const { id } = params
  if (!id) return jsonResponse(400, { ok: false, error: 'Falta id.' })

  const res = await fetch(`${API_URL}/employee-files/attachments/${id}`, {
    method: 'DELETE',
    headers: { Cookie: `auth=${identity.raw}`, 'X-Tenant': tenant },
  })
  if (res.status === 401) return jsonResponse(401, { ok: false, error: 'Sesión vencida.' })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    return jsonResponse(res.status, { ok: false, error: body.error ?? `HTTP ${res.status}` })
  }
  return jsonResponse(200, { ok: true })
}
