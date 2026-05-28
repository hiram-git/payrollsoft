import type { APIRoute } from 'astro'
import { getIdentity } from '../../../../lib/auth'

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

  const worker = url.searchParams.get('worker') ?? 'ingestion'
  const apiPath =
    worker === 'consolidation' ? '/attendance/consolidation/status' : '/attendance/ingestion/status'

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
  const worker = url.searchParams.get('worker') ?? 'ingestion'
  const op = url.searchParams.get('op') ?? ''
  const deviceId = url.searchParams.get('deviceId') ?? ''

  const body = await request.json().catch(() => ({}))
  let apiPath: string

  if (worker === 'consolidation') {
    switch (op) {
      case 'start':
        apiPath = '/attendance/consolidation/start'
        break
      case 'stop':
        apiPath = '/attendance/consolidation/stop'
        break
      case 'restart':
        apiPath = '/attendance/consolidation/restart'
        break
      case 'trigger':
        apiPath = '/attendance/consolidation/trigger'
        break
      default:
        return jsonResponse({ ok: false, error: 'Operación inválida' }, 400)
    }
  } else {
    if (!deviceId) return jsonResponse({ ok: false, error: 'deviceId requerido' }, 400)
    switch (op) {
      case 'start':
        apiPath = `/attendance/ingestion/${deviceId}/start`
        break
      case 'stop':
        apiPath = `/attendance/ingestion/${deviceId}/stop`
        break
      case 'restart':
        apiPath = `/attendance/ingestion/${deviceId}/restart`
        break
      case 'trigger':
        apiPath = `/attendance/ingestion/${deviceId}/trigger`
        break
      default:
        return jsonResponse({ ok: false, error: 'Operación inválida' }, 400)
    }
  }

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
