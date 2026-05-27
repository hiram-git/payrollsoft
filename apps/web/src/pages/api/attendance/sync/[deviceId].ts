import type { APIRoute } from 'astro'
import { getIdentity } from '../../../../lib/auth'

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export const GET: APIRoute = async ({ params, url, cookies }) => {
  const identity = getIdentity(cookies)
  if (!identity) return jsonResponse({ ok: false, error: 'Unauthorized' }, 401)

  const tenant = identity.tenantSlug ?? 'demo'
  const deviceId = params.deviceId
  const view = url.searchParams.get('view')

  const apiPath =
    view === 'log'
      ? `/attendance/sync/${deviceId}/log?limit=${url.searchParams.get('limit') ?? '50'}`
      : `/attendance/sync/${deviceId}/status`

  const res = await fetch(`${API_URL}${apiPath}`, {
    headers: {
      Cookie: `auth=${identity.raw}`,
      'X-Tenant': tenant,
    },
  })
  const json = await res.json().catch(() => ({}))
  return jsonResponse(
    { ok: res.ok, data: json.data ?? null, error: json.error ?? null },
    res.status
  )
}
