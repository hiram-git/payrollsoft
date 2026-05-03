import type { APIRoute } from 'astro'
import { getIdentity } from '../../../../../lib/auth'

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'

/** Form proxy for resetting the tenant admin password. */
export const POST: APIRoute = async ({ request, cookies, redirect, params }) => {
  const identity = getIdentity(cookies)
  if (!identity || identity.type !== 'super_admin') return redirect('/superadmin/login')

  const formData = await request.formData()
  const password = (formData.get('password') as string | null) ?? ''
  if (password.length < 12) {
    return redirect(`/superadmin/tenants/${params.slug}?error=server-error`)
  }

  let res: Response
  try {
    res = await fetch(`${API_URL}/superadmin/tenants/${params.slug}/admin/reset`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `auth=${identity.raw}`,
      },
      body: JSON.stringify({ password }),
    })
  } catch (err) {
    console.error('[superadmin/admin-reset] fetch failed:', err)
    return redirect(`/superadmin/tenants/${params.slug}?error=server-error`)
  }

  if (res.status === 404) return redirect(`/superadmin/tenants/${params.slug}?error=no-admin`)
  if (!res.ok) return redirect(`/superadmin/tenants/${params.slug}?error=server-error`)
  return redirect(`/superadmin/tenants/${params.slug}?flash=admin-reset`)
}
