import type { APIRoute } from 'astro'
import { getIdentity } from '../../../lib/auth'

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'

/**
 * POST /api/tenant-users/create — Astro form proxy that hits the API's
 * /tenant-users endpoint. Redirects back to the listing on success and to
 * the form (with an error flag) on failure.
 */
export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const identity = getIdentity(cookies)
  if (!identity) return redirect('/login')

  const formData = await request.formData()
  const name = (formData.get('name') as string | null)?.trim() ?? ''
  const email = (formData.get('email') as string | null)?.trim().toLowerCase() ?? ''
  const password = (formData.get('password') as string | null) ?? ''

  if (!name || !email || !password) {
    return redirect('/config/users/new?error=missing-fields')
  }
  if (password.length < 12) {
    return redirect('/config/users/new?error=weak-password')
  }

  const tenant = identity.tenantSlug ?? 'demo'
  let res: Response
  try {
    res = await fetch(`${API_URL}/tenant-users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `auth=${identity.raw}`,
        'X-Tenant': tenant,
      },
      body: JSON.stringify({ name, email, password }),
    })
  } catch (err) {
    console.error('[tenant-users/create] fetch failed:', err)
    return redirect('/config/users/new?error=server-error')
  }

  if (res.status === 409) return redirect('/config/users/new?error=email-taken')
  if (!res.ok) return redirect('/config/users/new?error=server-error')

  return redirect('/config/users?created=1')
}
