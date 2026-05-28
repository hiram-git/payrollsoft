/**
 * Proxy de aprobación. Reenvía al API con auth + tenant.
 *
 *   POST /api/employee-files/approve?id=UUID
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
  const id = (url.searchParams.get('id') ?? '').trim()
  if (!id) {
    return new Response(JSON.stringify({ ok: false, error: 'Falta id' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  const res = await fetch(`${API_URL}/employee-files/${id}/approve`, {
    method: 'POST',
    headers: { Cookie: `auth=${identity.raw}`, 'X-Tenant': tenant },
  })
  const text = await res.text()
  let json: { success?: boolean; error?: string } = {}
  try {
    json = text ? JSON.parse(text) : {}
  } catch {
    /* texto plano */
  }
  return new Response(
    JSON.stringify({ ok: res.ok && json.success !== false, error: json.error ?? null }),
    { status: res.status, headers: { 'Content-Type': 'application/json' } }
  )
}
