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

  const qs = url.searchParams.toString()
  const res = await fetch(`${API_URL}/approvals/delegations${qs ? `?${qs}` : ''}`, {
    headers: makeHeaders(identity),
  })
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
  const endId = url.searchParams.get('end') ?? ''
  const apiPath = endId ? `/approvals/delegations/${endId}/end` : '/approvals/delegations'

  const body = await request.json().catch(() => ({}))
  const res = await fetch(`${API_URL}${apiPath}`, {
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
