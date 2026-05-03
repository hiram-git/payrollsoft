import type { APIRoute } from 'astro'

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'

/** Form proxy for super-admin login. Mirrors /api/auth/login but hits
 *  /auth/superadmin/login and lands on /superadmin on success. */
export const POST: APIRoute = async ({ request, redirect }) => {
  const formData = await request.formData()
  const email = (formData.get('email') as string | null)?.trim().toLowerCase() ?? ''
  const password = (formData.get('password') as string | null) ?? ''

  if (!email || !password) {
    return redirect('/superadmin/login?error=missing-fields')
  }

  let res: Response
  try {
    res = await fetch(`${API_URL}/auth/superadmin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
  } catch (err) {
    console.error('[superadmin/login] fetch failed:', err)
    return redirect('/superadmin/login?error=server-error')
  }

  if (!res.ok) {
    return redirect(
      `/superadmin/login?error=${res.status === 401 ? 'invalid-credentials' : 'server-error'}`
    )
  }

  // Forward the Set-Cookie from the upstream response so the browser
  // stores the auth cookie under our origin.
  const headers = new Headers({ Location: '/superadmin' })
  const setCookie = res.headers.get('set-cookie')
  if (setCookie) headers.append('set-cookie', setCookie)
  return new Response(null, { status: 303, headers })
}
