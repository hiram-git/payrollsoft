import type { APIRoute } from 'astro'
import { getIdentity } from '../../../../lib/auth'

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'

/** Re-enable a previously deactivated tenant user. */
export const POST: APIRoute = async ({ cookies, redirect, params }) => {
  const identity = getIdentity(cookies)
  if (!identity) return redirect('/login')
  const tenant = identity.tenantSlug ?? 'demo'
  let res: Response
  try {
    res = await fetch(`${API_URL}/tenant-users/${params.id}/reactivate`, {
      method: 'POST',
      headers: { Cookie: `auth=${identity.raw}`, 'X-Tenant': tenant },
    })
  } catch (err) {
    console.error('[tenant-users/reactivate] fetch failed:', err)
    return redirect(`/config/users/${params.id}?error=server-error`)
  }
  if (!res.ok) {
    let detail = 'server-error'
    try {
      const body = (await res.json()) as { error?: string }
      if (body.error) detail = body.error
    } catch {}
    return redirect(
      `/config/users/${params.id}?error=reactivate&detail=${encodeURIComponent(detail)}`
    )
  }
  return redirect(`/config/users/${params.id}?flash=reactivated`)
}
