/**
 * Proxy de acciones para dispositivos de marcación.
 *
 *   POST /api/attendance/devices?op=create    → POST /attendance/devices
 *   POST /api/attendance/devices?op=update&id=UUID → PUT /attendance/devices/:id
 *   POST /api/attendance/devices?op=rotate&id=UUID → POST /attendance/devices/:id/rotate
 */
import type { APIRoute } from 'astro'
import { getIdentity } from '../../../lib/auth'

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'

export const POST: APIRoute = async ({ request, cookies }) => {
  const identity = getIdentity(cookies)
  if (!identity) {
    return new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  const tenant = identity.tenantSlug ?? 'demo'
  const url = new URL(request.url)
  const op = (url.searchParams.get('op') ?? '').trim()
  const id = (url.searchParams.get('id') ?? '').trim()

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>

  const call = async (path: string, method: string, payload?: unknown) => {
    const res = await fetch(`${API_URL}${path}`, {
      method,
      headers: {
        Cookie: `auth=${identity.raw}`,
        'X-Tenant': tenant,
        'Content-Type': 'application/json',
      },
      body: payload == null ? undefined : JSON.stringify(payload),
    })
    const text = await res.text()
    let json: { success?: boolean; error?: string; data?: unknown } = {}
    try {
      json = text ? JSON.parse(text) : {}
    } catch {
      /* */
    }
    return { ok: res.ok && json.success !== false, status: res.status, json }
  }

  let result: { ok: boolean; status: number; json: { error?: string; data?: unknown } }

  switch (op) {
    case 'create':
      result = await call('/attendance/devices', 'POST', body)
      break
    case 'update':
      result = await call(`/attendance/devices/${id}`, 'PUT', body)
      break
    case 'rotate':
      result = await call(`/attendance/devices/${id}/rotate`, 'POST')
      break
    default:
      return new Response(JSON.stringify({ ok: false, error: 'Operación inválida' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
  }

  return new Response(
    JSON.stringify({
      ok: result.ok,
      error: result.ok ? null : (result.json.error ?? `HTTP ${result.status}`),
      data: result.json.data ?? null,
    }),
    { status: result.status, headers: { 'Content-Type': 'application/json' } }
  )
}
