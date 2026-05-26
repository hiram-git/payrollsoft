import type { APIRoute } from 'astro'
import { getIdentity } from '../../../lib/auth'

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'

const ALLOWED_PREFIXES = ['balance', 'movements']

export const GET: APIRoute = async ({ request, cookies }) => {
  const identity = getIdentity(cookies)
  if (!identity) return new Response('Unauthorized', { status: 401 })
  const tenant = identity.tenantSlug ?? 'demo'

  const url = new URL(request.url)
  const rawPath = (url.searchParams.get('path') ?? '').trim()
  if (!rawPath) return new Response('Missing path', { status: 400 })
  if (
    !ALLOWED_PREFIXES.some(
      (p) => rawPath === p || rawPath.startsWith(`${p}/`) || rawPath.startsWith(`${p}?`)
    )
  ) {
    return new Response('Path not allowed', { status: 403 })
  }

  const apiUrl = `${API_URL}/compensatory-time/${rawPath}`
  const res = await fetch(apiUrl, {
    headers: {
      Cookie: `auth=${identity.raw}`,
      'X-Tenant': tenant,
    },
  })
  return new Response(res.body, {
    status: res.status,
    headers: { 'Content-Type': 'application/json' },
  })
}
