import type { APIRoute } from 'astro'
import { getIdentity } from '../../../../lib/auth'

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'

/** PATCH /tenant-users/:id — edits the user's display name. */
export const POST: APIRoute = async ({ request, cookies, redirect, params }) => {
  const identity = getIdentity(cookies)
  if (!identity) return redirect('/login')

  const formData = await request.formData()
  const name = ((formData.get('name') as string | null) ?? '').trim()
  if (!name) {
    return redirect(`/config/users/${params.id}?error=missing-fields`)
  }

  const tenant = identity.tenantSlug ?? 'demo'
  let res: Response
  try {
    res = await fetch(`${API_URL}/tenant-users/${params.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `auth=${identity.raw}`,
        'X-Tenant': tenant,
      },
      body: JSON.stringify({ name }),
    })
  } catch (err) {
    console.error('[tenant-users/update] fetch failed:', err)
    return redirect(`/config/users/${params.id}?error=server-error`)
  }

  if (!res.ok) {
    let detail = 'server-error'
    try {
      const body = (await res.json()) as { error?: string }
      if (body.error) detail = body.error
    } catch {}
    return redirect(`/config/users/${params.id}?error=update&detail=${encodeURIComponent(detail)}`)
  }
  return redirect(`/config/users/${params.id}?flash=updated`)
}
