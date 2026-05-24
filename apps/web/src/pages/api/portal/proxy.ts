import type { APIRoute } from 'astro'
import { getPortalIdentity } from '../../../lib/portal-auth'

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'

const GET_PREFIXES = [
  'file-types',
  'file-fields',
  'requests',
  'dashboard',
  'approvals',
  'attendance',
]
const POST_PREFIXES = ['approvals']

function validatePath(rawPath: string, allowed: string[]) {
  if (!rawPath) return false
  return allowed.some(
    (p) => rawPath === p || rawPath.startsWith(`${p}/`) || rawPath.startsWith(`${p}?`)
  )
}

export const GET: APIRoute = async ({ request, cookies }) => {
  const identity = getPortalIdentity(cookies)
  if (!identity)
    return Response.json({ success: false, error: 'Not authenticated' }, { status: 401 })

  const url = new URL(request.url)
  const rawPath = (url.searchParams.get('path') ?? '').trim()
  if (!validatePath(rawPath, GET_PREFIXES)) {
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

export const POST: APIRoute = async ({ request, cookies }) => {
  const identity = getPortalIdentity(cookies)
  if (!identity)
    return Response.json({ success: false, error: 'Not authenticated' }, { status: 401 })

  const url = new URL(request.url)
  const rawPath = (url.searchParams.get('path') ?? '').trim()
  if (!validatePath(rawPath, POST_PREFIXES)) {
    return Response.json({ success: false, error: 'Path not allowed' }, { status: 403 })
  }

  try {
    const bodyText = await request.text()
    const res = await fetch(`${API_URL}/portal/data/${rawPath}`, {
      method: 'POST',
      headers: {
        Cookie: `portal_auth=${identity.raw}`,
        'X-Tenant': identity.tenantSlug,
        'Content-Type': 'application/json',
      },
      body: bodyText,
    })
    const data = await res.text()
    return new Response(data, {
      status: res.status,
      headers: { 'Content-Type': res.headers.get('content-type') ?? 'application/json' },
    })
  } catch {
    return Response.json({ success: false, error: 'Connection error' }, { status: 502 })
  }
}
