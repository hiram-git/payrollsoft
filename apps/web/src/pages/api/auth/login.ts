import type { APIRoute } from 'astro'

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'

export const POST: APIRoute = async ({ request, redirect }) => {
  const formData = await request.formData()
  const email = formData.get('email') as string
  const password = formData.get('password') as string
  const tenant = (formData.get('tenant') as string)?.trim().toLowerCase()

  if (!email || !password || !tenant) {
    return redirect('/login?error=missing-fields')
  }

  let res: Response
  try {
    res = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant': tenant,
      },
      body: JSON.stringify({ email, password }),
    })
  } catch (err) {
    console.error('[login] fetch failed:', err)
    return redirect('/login?error=server-error')
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    console.error(`[login] API returned ${res.status}:`, body)
    const errorParam = res.status === 401 ? 'invalid-credentials' : 'server-error'
    return redirect(`/login?error=${errorParam}`)
  }

  // Forward the JWT cookie Elysia set and redirect to dashboard
  const setCookie = res.headers.get('set-cookie')
  const headers = new Headers({ Location: '/dashboard' })
  if (setCookie) {
    headers.set('Set-Cookie', setCookie)
  }

  return new Response(null, { status: 302, headers })
}
