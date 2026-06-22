import type { APIRoute } from 'astro'
import { getIdentity } from '../../../lib/auth'

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function makeHeaders(identity: { raw: string; tenantSlug: string | null }) {
  return {
    Cookie: `auth=${identity.raw}`,
    'X-Tenant': identity.tenantSlug ?? 'demo',
    'Content-Type': 'application/json',
  }
}

export const GET: APIRoute = async ({ url, cookies }) => {
  const identity = getIdentity(cookies)
  if (!identity) return jsonResponse({ ok: false, error: 'Unauthorized' }, 401)

  const view = url.searchParams.get('view') ?? 'status'
  const apiPath = view === 'log' ? '/time-balance/renewal/log' : '/time-balance/renewal/status'

  const res = await fetch(`${API_URL}${apiPath}`, { headers: makeHeaders(identity) })
  const json = await res.json().catch(() => ({}))
  return jsonResponse(
    { ok: res.ok, data: json.data ?? null, error: json.error ?? null },
    res.status
  )
}

export const POST: APIRoute = async ({ request, cookies }) => {
  const identity = getIdentity(cookies)
  if (!identity) return jsonResponse({ ok: false, error: 'Unauthorized' }, 401)

  const url = new URL(request.url)
  const op = url.searchParams.get('op') ?? ''
  const ALLOWED = ['start', 'stop', 'restart', 'trigger']
  if (!ALLOWED.includes(op)) return jsonResponse({ ok: false, error: 'Operación inválida' }, 400)

  const body = await request.json().catch(() => ({}))
  const res = await fetch(`${API_URL}/time-balance/renewal/${op}`, {
    method: 'POST',
    headers: makeHeaders(identity),
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({}))
  return jsonResponse(
    { ok: res.ok && json.success !== false, data: json.data ?? null, error: json.error ?? null },
    res.status
  )
}
