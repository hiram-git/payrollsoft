import type { APIRoute } from 'astro'
import { getIdentity } from '../../../../lib/auth'

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'

/** PUT /users/:userId/roles — replace a user's role assignments. */
export const POST: APIRoute = async ({ request, cookies, redirect, params }) => {
  const identity = getIdentity(cookies)
  if (!identity) return redirect('/login')

  const formData = await request.formData()
  const roleIds = formData.getAll('roleIds').map((r) => String(r))

  const tenant = identity.tenantSlug ?? 'demo'
  let res: Response
  try {
    res = await fetch(`${API_URL}/users/${params.id}/roles`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `auth=${identity.raw}`,
        'X-Tenant': tenant,
      },
      body: JSON.stringify({ roleIds }),
    })
  } catch (err) {
    console.error('[users/roles] fetch failed:', err)
    return redirect(`/config/users/${params.id}?error=server-error`)
  }
  if (!res.ok) {
    let detail = 'server-error'
    try {
      const text = await res.text()
      console.error(`[users/roles] API ${res.status} body:`, text)
      try {
        const body = JSON.parse(text) as { error?: string; message?: string }
        detail = body.error ?? body.message ?? text.slice(0, 200) ?? 'server-error'
      } catch {
        detail = text.slice(0, 200) || 'server-error'
      }
    } catch {}
    return redirect(`/config/users/${params.id}?error=roles&detail=${encodeURIComponent(detail)}`)
  }
  return redirect(`/config/users/${params.id}?flash=roles-updated`)
}
