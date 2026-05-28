/**
 * POST /api/attendance/import
 *
 * Proxy que reenvía el multipart/form-data al API backend
 * con auth + tenant headers.
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

  const formData = await request.formData()
  const apiFormData = new FormData()
  for (const [key, value] of formData.entries()) {
    apiFormData.append(key, value)
  }

  const res = await fetch(`${API_URL}/attendance/import`, {
    method: 'POST',
    headers: { Cookie: `auth=${identity.raw}`, 'X-Tenant': tenant },
    body: apiFormData,
  })

  const text = await res.text()
  let json: { success?: boolean; error?: string; data?: unknown } = {}
  try {
    json = text ? JSON.parse(text) : {}
  } catch {
    /* texto plano */
  }

  return new Response(
    JSON.stringify({
      ok: res.ok && json.success !== false,
      error: json.error ?? null,
      data: json.data ?? null,
    }),
    { status: res.status, headers: { 'Content-Type': 'application/json' } }
  )
}
