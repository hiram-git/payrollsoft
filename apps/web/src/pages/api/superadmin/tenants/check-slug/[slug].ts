import type { APIRoute } from 'astro'
import { getIdentity } from '../../../../../lib/auth'

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'

/**
 * Proxy for the wizard's live slug-availability check. Runs in the
 * Astro server, so the auth cookie (which lives on the web's origin)
 * is forwarded as a Cookie header to the API regardless of how
 * different the two hosts are in production. Replaces a previous
 * direct-from-browser fetch that died as 401 on Railway because
 * the API's host has no cookie of its own.
 */
export const GET: APIRoute = async ({ cookies, params }) => {
  const identity = getIdentity(cookies)
  if (!identity || identity.type !== 'super_admin') {
    return new Response(JSON.stringify({ success: false, error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const slug = String(params.slug ?? '')
  let res: Response
  try {
    res = await fetch(`${API_URL}/superadmin/tenants/check-slug/${encodeURIComponent(slug)}`, {
      headers: { Cookie: `auth=${identity.raw}` },
    })
  } catch (err) {
    console.error('[superadmin/check-slug] fetch failed:', err)
    return new Response(JSON.stringify({ success: false, error: 'server-error' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Pipe the API body through verbatim — the wizard already speaks the
  // shape `{ success, data: { available, ... } }`.
  const body = await res.text()
  return new Response(body, {
    status: res.status,
    headers: { 'Content-Type': 'application/json' },
  })
}
