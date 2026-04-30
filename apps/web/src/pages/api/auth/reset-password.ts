import type { APIRoute } from 'astro'

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'

const MIN_PASSWORD_LENGTH = 8

/**
 * Proxy for the "reset password" form. Validates the inputs locally
 * (required fields, password length, confirmation match) and forwards
 * the redemption to the API. Token state errors (`expired`, `used`,
 * `invalid`, `user_missing`) are mapped to dedicated query params so
 * the page can render a friendly message.
 */
export const POST: APIRoute = async ({ request, redirect }) => {
  const formData = await request.formData()
  const token = (formData.get('token') as string | null)?.trim() ?? ''
  const tenant = (formData.get('tenant') as string | null)?.trim().toLowerCase() ?? ''
  const password = (formData.get('password') as string | null) ?? ''
  const confirm = (formData.get('confirm') as string | null) ?? ''

  const params = new URLSearchParams({ token, tenant })

  if (!token || !tenant) {
    params.set('error', 'invalid-link')
    return redirect(`/reset-password?${params.toString()}`)
  }
  if (!password || !confirm) {
    params.set('error', 'missing-fields')
    return redirect(`/reset-password?${params.toString()}`)
  }
  if (password !== confirm) {
    params.set('error', 'mismatch')
    return redirect(`/reset-password?${params.toString()}`)
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    params.set('error', 'too-short')
    return redirect(`/reset-password?${params.toString()}`)
  }

  let res: Response
  try {
    res = await fetch(`${API_URL}/auth/reset-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant': tenant,
      },
      body: JSON.stringify({ token, password }),
    })
  } catch (err) {
    console.error('[reset-password] fetch failed:', err)
    params.set('error', 'server-error')
    return redirect(`/reset-password?${params.toString()}`)
  }

  if (res.ok) {
    // Success → land on the login page with a friendly notice.
    return redirect('/login?reset=ok')
  }

  // 410 Gone is what the API uses for token state failures.
  let apiError: string | undefined
  try {
    const body = (await res.json()) as { error?: string }
    apiError = body.error
  } catch {
    apiError = undefined
  }

  const knownErrors = new Set(['expired', 'used', 'invalid', 'user_missing'])
  params.set('error', apiError && knownErrors.has(apiError) ? apiError : 'server-error')
  return redirect(`/reset-password?${params.toString()}`)
}
