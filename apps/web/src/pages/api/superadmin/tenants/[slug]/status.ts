import type { APIRoute } from 'astro'
import { getIdentity } from '../../../../../lib/auth'

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'

/** Form proxy for /superadmin/tenants/:slug status changes. */
export const POST: APIRoute = async ({ request, cookies, redirect, params }) => {
  const identity = getIdentity(cookies)
  if (!identity || identity.type !== 'super_admin') return redirect('/superadmin/login')

  const formData = await request.formData()
  const status = (formData.get('status') as string | null) ?? ''
  if (!['ACTIVE', 'SUSPENDED', 'ARCHIVED'].includes(status)) {
    return redirect(`/superadmin/tenants/${params.slug}?error=server-error`)
  }

  let res: Response
  try {
    res = await fetch(`${API_URL}/superadmin/tenants/${params.slug}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `auth=${identity.raw}`,
      },
      body: JSON.stringify({ status }),
    })
  } catch (err) {
    console.error('[superadmin/tenants/:slug/status] fetch failed:', err)
    return redirect(`/superadmin/tenants/${params.slug}?error=server-error`)
  }

  if (!res.ok) {
    return redirect(`/superadmin/tenants/${params.slug}?error=server-error`)
  }
  return redirect(`/superadmin/tenants/${params.slug}?flash=updated`)
}
