import type { APIRoute } from 'astro'
import { getIdentity } from '../../../lib/auth'

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'

export const GET: APIRoute = async ({ cookies }) => {
  const identity = getIdentity(cookies)
  if (!identity) return Response.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  const tenant = identity.tenantSlug ?? 'demo'

  try {
    const res = await fetch(`${API_URL}/portal/credentials/status`, {
      headers: { Cookie: `auth=${identity.raw}`, 'X-Tenant': tenant },
    })
    const data = await res.json()
    return Response.json(data, { status: res.status })
  } catch {
    return Response.json({ success: false, error: 'Connection error' }, { status: 502 })
  }
}

export const POST: APIRoute = async ({ request, cookies }) => {
  const identity = getIdentity(cookies)
  if (!identity) return Response.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  const tenant = identity.tenantSlug ?? 'demo'

  const body = await request.json().catch(() => null)
  if (!body || !body.action) {
    return Response.json({ success: false, error: 'Missing action' }, { status: 400 })
  }

  const actionMap: Record<string, { path: string; payload: unknown }> = {
    create: {
      path: '/portal/credentials',
      payload: { employeeId: body.employeeId, password: body.password },
    },
    reset: {
      path: '/portal/credentials/reset',
      payload: { employeeId: body.employeeId, password: body.password },
    },
    unlock: {
      path: '/portal/credentials/unlock',
      payload: { employeeId: body.employeeId },
    },
    'toggle-approver': {
      path: '/portal/credentials/toggle-approver',
      payload: { employeeId: body.employeeId, isApprover: body.isApprover },
    },
  }

  const action = actionMap[body.action]
  if (!action) {
    return Response.json({ success: false, error: 'Unknown action' }, { status: 400 })
  }

  try {
    const res = await fetch(`${API_URL}${action.path}`, {
      method: 'POST',
      headers: {
        Cookie: `auth=${identity.raw}`,
        'X-Tenant': tenant,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(action.payload),
    })
    const data = await res.json()
    return Response.json(data, { status: res.status })
  } catch {
    return Response.json({ success: false, error: 'Connection error' }, { status: 502 })
  }
}
