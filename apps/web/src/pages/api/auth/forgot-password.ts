import type { APIRoute } from 'astro'

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'

/**
 * Proxy for the "forgot password" form. The downstream API answers
 * `200 { success: true }` whether or not the email matches a real
 * account, so we do the same here to avoid leaking account presence.
 * Anything other than a 200 from the API surfaces as a `server-error`.
 */
export const POST: APIRoute = async ({ request, redirect }) => {
  const formData = await request.formData()
  const email = (formData.get('email') as string | null)?.trim().toLowerCase() ?? ''
  const tenant = (formData.get('tenant') as string | null)?.trim().toLowerCase() ?? ''

  if (!email || !tenant) {
    return redirect('/forgot-password?error=missing-fields')
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return redirect('/forgot-password?error=invalid-email')
  }

  try {
    const res = await fetch(`${API_URL}/auth/forgot-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant': tenant,
      },
      body: JSON.stringify({ email }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      console.error(`[forgot-password] API returned ${res.status}:`, body)
      return redirect('/forgot-password?error=server-error')
    }
  } catch (err) {
    console.error('[forgot-password] fetch failed:', err)
    return redirect('/forgot-password?error=server-error')
  }

  // Always reach the success state, even for unknown emails — the user
  // sees the same confirmation either way.
  return redirect('/forgot-password?sent=1')
}
