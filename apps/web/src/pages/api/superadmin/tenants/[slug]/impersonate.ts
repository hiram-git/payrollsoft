import type { APIRoute } from 'astro'
import { getIdentity } from '../../../../../lib/auth'

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'

/**
 * Form proxy that swaps the super-admin's JWT for a short-lived
 * tenant_admin JWT. The original super-admin token is stashed in the
 * `sa_session` cookie so /api/superadmin/end-impersonation can put it
 * back without forcing a re-login.
 */
export const POST: APIRoute = async ({ cookies, redirect, params }) => {
  const identity = getIdentity(cookies)
  if (!identity || identity.type !== 'super_admin') {
    return redirect('/superadmin/login')
  }

  let res: Response
  try {
    res = await fetch(`${API_URL}/superadmin/tenants/${params.slug}/impersonate`, {
      method: 'POST',
      headers: { Cookie: `auth=${identity.raw}` },
    })
  } catch (err) {
    console.error('[impersonate] fetch failed:', err)
    return redirect(`/superadmin/tenants/${params.slug}?error=server-error`)
  }

  if (!res.ok) {
    return redirect(`/superadmin/tenants/${params.slug}?error=server-error`)
  }

  const json = (await res.json()) as { data?: { token?: string; expiresInSeconds?: number } }
  const token = json.data?.token
  const ttl = json.data?.expiresInSeconds ?? 30 * 60
  if (!token) {
    return redirect(`/superadmin/tenants/${params.slug}?error=server-error`)
  }

  // Save the original super-admin JWT so we can restore it on exit.
  cookies.set('sa_session', identity.raw, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: ttl,
  })

  // Replace the auth cookie with the tenant_admin token.
  cookies.set('auth', token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: ttl,
  })

  return redirect('/config/users')
}
