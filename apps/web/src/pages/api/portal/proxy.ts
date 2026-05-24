import type { APIRoute } from 'astro'
import { getPortalIdentity } from '../../../lib/portal-auth'

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'

const ALLOWED_PREFIXES = ['file-types', 'file-fields']

export const GET: APIRoute = async ({ request, cookies }) => {
  const identity = getPortalIdentity(cookies)
  if (!identity)
    return Response.json({ success: false, error: 'Not authenticated' }, { status: 401 })

  const url = new URL(request.url)
  const rawPath = (url.searchParams.get('path') ?? '').trim()
  if (!rawPath) return Response.json({ success: false, error: 'Missing path' }, { status: 400 })
  if (
    !ALLOWED_PREFIXES.some(
      (p) => rawPath === p || rawPath.startsWith(`${p}/`) || rawPath.startsWith(`${p}?`)
    )
  ) {
    return Response.json({ success: false, error: 'Path not allowed' }, { status: 403 })
  }

  try {
    const res = await fetch(`${API_URL}/portal/data/${rawPath}`, {
      headers: { Cookie: `portal_auth=${identity.raw}`, 'X-Tenant': identity.tenantSlug },
    })
    const body = await res.text()
    return new Response(body, {
      status: res.status,
      headers: { 'Content-Type': res.headers.get('content-type') ?? 'application/json' },
    })
  } catch {
    return Response.json({ success: false, error: 'Connection error' }, { status: 502 })
  }
}
