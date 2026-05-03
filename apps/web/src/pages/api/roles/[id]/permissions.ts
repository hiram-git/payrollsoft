import type { APIRoute } from 'astro'
import { getIdentity } from '../../../../lib/auth'

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'

/** Form proxy for replacing the permission set of a role. */
export const POST: APIRoute = async ({ request, cookies, redirect, params }) => {
  const identity = getIdentity(cookies)
  if (!identity) return redirect('/login')

  const formData = await request.formData()
  const permissions = formData.getAll('permissions').map((p) => String(p))

  const tenant = identity.tenantSlug ?? 'demo'
  let res: Response
  try {
    res = await fetch(`${API_URL}/roles/${params.id}/permissions`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `auth=${identity.raw}`,
        'X-Tenant': tenant,
      },
      body: JSON.stringify({ permissions }),
    })
  } catch (err) {
    console.error('[roles/permissions] fetch failed:', err)
    return redirect(`/config/roles/${params.id}?error=server-error`)
  }

  if (!res.ok) {
    return redirect(`/config/roles/${params.id}?error=server-error`)
  }
  return redirect(`/config/roles/${params.id}?flash=updated`)
}
