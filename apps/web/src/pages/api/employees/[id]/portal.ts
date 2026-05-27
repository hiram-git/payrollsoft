import type { APIRoute } from 'astro'
import { getIdentity } from '../../../../lib/auth'

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'

export const GET: APIRoute = async ({ params, cookies }) => {
  const identity = getIdentity(cookies)
  if (!identity) return Response.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  const tenant = identity.tenantSlug ?? 'demo'

  try {
    const res = await fetch(`${API_URL}/portal/credentials/access/${params.id}`, {
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

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return Response.json({ success: false, error: 'Invalid request' }, { status: 400 })
  }

  if (body.resetPassword) {
    try {
      const res = await fetch(`${API_URL}/portal/credentials/reset`, {
        method: 'POST',
        headers: {
          Cookie: `auth=${identity.raw}`,
          'X-Tenant': tenant,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ employeeId: params.id, password: '172839' }),
      })
      const data = await res.json()
      return Response.json(data, { status: res.status })
    } catch {
      return Response.json({ success: false, error: 'Connection error' }, { status: 502 })
    }
  }

  try {
    const res = await fetch(`${API_URL}/portal/credentials/access/${params.id}`, {
      method: 'POST',
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
