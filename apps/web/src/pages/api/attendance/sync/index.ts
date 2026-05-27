import type { APIRoute } from 'astro'
import { getIdentity } from '../../../../lib/auth'

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export const GET: APIRoute = async ({ cookies }) => {
  const identity = getIdentity(cookies)
  if (!identity) return jsonResponse({ ok: false, error: 'Unauthorized' }, 401)

  const tenant = identity.tenantSlug ?? 'demo'
  const res = await fetch(`${API_URL}/attendance/sync/status`, {
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

export const POST: APIRoute = async ({ request, cookies }) => {
  const identity = getIdentity(cookies)
  if (!identity) return jsonResponse({ ok: false, error: 'Unauthorized' }, 401)

  const tenant = identity.tenantSlug ?? 'demo'
  const url = new URL(request.url)
  const op = url.searchParams.get('op') ?? ''
  const deviceId = url.searchParams.get('deviceId') ?? ''

  if (!deviceId) return jsonResponse({ ok: false, error: 'deviceId requerido' }, 400)

  const body = await request.json().catch(() => ({}))

  let apiPath: string
  const method = 'POST'

  switch (op) {
    case 'start':
      apiPath = `/attendance/sync/${deviceId}/start`
      break
    case 'stop':
      apiPath = `/attendance/sync/${deviceId}/stop`
      break
    case 'restart':
      apiPath = `/attendance/sync/${deviceId}/restart`
      break
    case 'trigger':
      apiPath = `/attendance/sync/${deviceId}/trigger`
      break
    default:
      return jsonResponse({ ok: false, error: 'Operación inválida' }, 400)
  }

  const res = await fetch(`${API_URL}${apiPath}`, {
    method,
    headers: {
      Cookie: `auth=${identity.raw}`,
      'X-Tenant': tenant,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({}))
  return jsonResponse(
    { ok: res.ok && json.success !== false, data: json.data ?? null, error: json.error ?? null },
    res.status
  )
}
