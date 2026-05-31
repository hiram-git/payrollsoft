import type { APIRoute } from 'astro'
import { getIdentity } from '../../../lib/auth'

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'

/**
 * Same-origin proxy for facial enrollment. The employee edit page computes a
 * 128-d face descriptor in the browser (face-api, same models as the kiosk)
 * and POSTs it here; we forward to the API with the httpOnly auth cookie and
 * tenant header. Mirrors the dependents proxy.
 */
export const POST: APIRoute = async ({ request, cookies }) => {
  const identity = getIdentity(cookies)
  if (!identity) return Response.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  const tenant = identity.tenantSlug ?? 'demo'

  const body = await request.json().catch(() => null)
  if (!body) return Response.json({ success: false, error: 'Invalid body' }, { status: 400 })

  try {
    const res = await fetch(`${API_URL}/facial/enrollments`, {
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
