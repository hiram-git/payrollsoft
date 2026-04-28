import type { APIRoute } from 'astro'

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'
const TENANT = 'demo'

/**
 * Thin proxy for the position-code availability check that powers the
 * realtime onBlur feedback on the create / edit forms. The backend
 * already validates the input — this exists so the browser script can
 * hit a same-origin endpoint and inherit the auth cookie automatically.
 */
export const GET: APIRoute = async ({ request, cookies }) => {
  const authCookie = cookies.get('auth')?.value
  if (!authCookie) {
    return new Response(JSON.stringify({ available: false, reason: 'unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const url = new URL(request.url)
  const code = url.searchParams.get('code')?.trim() ?? ''
  const excludeId = url.searchParams.get('excludeId')?.trim() ?? ''
  if (!code) {
    return new Response(JSON.stringify({ available: false, reason: 'empty' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const params = new URLSearchParams({ code })
  if (excludeId) params.set('excludeId', excludeId)

  const apiRes = await fetch(`${API_URL}/positions/check-code?${params}`, {
    headers: { Cookie: `auth=${authCookie}`, 'X-Tenant': TENANT },
  })
  const text = await apiRes.text()
  return new Response(text, {
    status: apiRes.status,
    headers: { 'Content-Type': apiRes.headers.get('Content-Type') ?? 'application/json' },
  })
}
