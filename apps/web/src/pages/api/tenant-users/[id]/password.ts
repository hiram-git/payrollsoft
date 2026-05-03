import type { APIRoute } from 'astro'
import { getIdentity } from '../../../../lib/auth'

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'

/** Force-rotate a tenant user's password. */
export const POST: APIRoute = async ({ request, cookies, redirect, params }) => {
  const identity = getIdentity(cookies)
  if (!identity) return redirect('/login')

  const formData = await request.formData()
  const password = (formData.get('password') as string | null) ?? ''
  if (password.length < 12) {
    return redirect(`/config/users/${params.id}?error=weak-password`)
  }

  const tenant = identity.tenantSlug ?? 'demo'
  let res: Response
  try {
    res = await fetch(`${API_URL}/tenant-users/${params.id}/password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `auth=${identity.raw}`,
        'X-Tenant': tenant,
      },
      body: JSON.stringify({ password }),
    })
  } catch (err) {
    console.error('[tenant-users/password] fetch failed:', err)
    return redirect(`/config/users/${params.id}?error=server-error`)
  }
  if (!res.ok) {
    let detail = 'server-error'
    try {
      const body = (await res.json()) as { error?: string }
      if (body.error) detail = body.error
    } catch {}
    return redirect(
      `/config/users/${params.id}?error=password&detail=${encodeURIComponent(detail)}`
    )
  }
  return redirect(`/config/users/${params.id}?flash=password-updated`)
}
