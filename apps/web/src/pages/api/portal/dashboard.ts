import type { APIRoute } from 'astro'
import { getPortalIdentity } from '../../../lib/portal-auth'

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'

export const GET: APIRoute = async ({ cookies }) => {
  const identity = getPortalIdentity(cookies)
  if (!identity) {
    return Response.json({ success: false, error: 'Not authenticated' }, { status: 401 })
  }

  try {
    const res = await fetch(`${API_URL}/portal/data/dashboard`, {
      headers: {
        Cookie: `portal_auth=${identity.raw}`,
        'X-Tenant': identity.tenantSlug,
      },
    })
    const data = await res.json()
    return Response.json(data, { status: res.status })
  } catch {
    return Response.json({ success: false, error: 'Error de conexión.' }, { status: 502 })
  }
}
