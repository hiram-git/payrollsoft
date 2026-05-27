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

  const headers = {
    Cookie: `auth=${identity.raw}`,
    'X-Tenant': identity.tenantSlug ?? 'demo',
  }

  const deviceId = params.deviceId
  const view = url.searchParams.get('view')
  const worker = url.searchParams.get('worker') ?? 'ingestion'

  let apiPath: string
  if (worker === 'consolidation') {
    apiPath =
      view === 'log'
        ? `/attendance/consolidation/log?limit=${url.searchParams.get('limit') ?? '50'}`
        : '/attendance/consolidation/status'
  } else {
    apiPath =
      view === 'log'
        ? `/attendance/ingestion/${deviceId}/log?limit=${url.searchParams.get('limit') ?? '50'}`
        : `/attendance/ingestion/${deviceId}/status`
  }

  const res = await fetch(`${API_URL}${apiPath}`, { headers })
  const json = await res.json().catch(() => ({}))
  return jsonResponse(
    { ok: res.ok, data: json.data ?? null, error: json.error ?? null },
    res.status
  )
}
