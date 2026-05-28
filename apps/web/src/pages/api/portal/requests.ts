import type { APIRoute } from 'astro'
import { getPortalIdentity } from '../../../lib/portal-auth'

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'

export const POST: APIRoute = async ({ request, cookies }) => {
  const identity = getPortalIdentity(cookies)
  if (!identity)
    return Response.json({ success: false, error: 'Not authenticated' }, { status: 401 })

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return Response.json({ success: false, error: 'Invalid form data.' }, { status: 400 })
  }

  try {
    const res = await fetch(`${API_URL}/portal/data/requests`, {
      method: 'POST',
      headers: { Cookie: `portal_auth=${identity.raw}`, 'X-Tenant': identity.tenantSlug },
      body: form,
    })
    const data = await res.json().catch(() => ({ success: false, error: 'Server error' }))
    return Response.json(data, { status: res.status })
  } catch {
    return Response.json({ success: false, error: 'Connection error.' }, { status: 502 })
  }
}
