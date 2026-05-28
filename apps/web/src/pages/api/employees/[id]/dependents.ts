import type { APIRoute } from 'astro'
import { getIdentity } from '../../../../lib/auth'

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'

export const GET: APIRoute = async ({ params, cookies }) => {
  const identity = getIdentity(cookies)
  if (!identity) return Response.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  const tenant = identity.tenantSlug ?? 'demo'

  try {
    const res = await fetch(`${API_URL}/dependents/${params.id}`, {
      headers: { Cookie: `auth=${identity.raw}`, 'X-Tenant': tenant },
    })
    const data = await res.json()
    return Response.json(data, { status: res.status })
  } catch {
    return Response.json({ success: false, error: 'Connection error' }, { status: 502 })
  }
}

export const POST: APIRoute = async ({ params, request, cookies }) => {
  const identity = getIdentity(cookies)
  if (!identity) return Response.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  const tenant = identity.tenantSlug ?? 'demo'

  const body = await request.json().catch(() => null)
  if (!body) return Response.json({ success: false, error: 'Invalid body' }, { status: 400 })

  const url = body._id
    ? `${API_URL}/dependents/${params.id}/${body._id}`
    : `${API_URL}/dependents/${params.id}`
  const method = body._id ? 'PUT' : 'POST'

  try {
    const res = await fetch(url, {
      method,
      headers: {
        Cookie: `auth=${identity.raw}`,
        'X-Tenant': tenant,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
    const data = await res.json()
    return Response.json(data, { status: res.status })
  } catch {
    return Response.json({ success: false, error: 'Connection error' }, { status: 502 })
  }
}

export const DELETE: APIRoute = async ({ params, request, cookies }) => {
  const identity = getIdentity(cookies)
  if (!identity) return Response.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  const tenant = identity.tenantSlug ?? 'demo'

  const body = await request.json().catch(() => null)
  const depId = body?.dependentId
  if (!depId) return Response.json({ success: false, error: 'Missing id' }, { status: 400 })

  try {
    const res = await fetch(`${API_URL}/dependents/${params.id}/${depId}`, {
      method: 'DELETE',
      headers: { Cookie: `auth=${identity.raw}`, 'X-Tenant': tenant },
    })
    const data = await res.json()
    return Response.json(data, { status: res.status })
  } catch {
    return Response.json({ success: false, error: 'Connection error' }, { status: 502 })
  }
}
