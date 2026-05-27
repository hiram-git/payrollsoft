/**
 * Proxy para descarga e in-line preview de adjuntos. Streamea el
 * archivo desde el API forwardeando los headers de Content-Type y
 * Content-Disposition correctos.
 *
 *   GET /api/employee-files/attachment/:id/preview  → inline
 *   GET /api/employee-files/attachment/:id/download → attachment
 */
import type { APIRoute } from 'astro'
import { getIdentity } from '../../../../../lib/auth'

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'

export const GET: APIRoute = async ({ params, cookies, redirect }) => {
  const identity = getIdentity(cookies)
  if (!identity) return redirect('/login')
  const tenant = identity.tenantSlug ?? 'demo'
  const { id, action } = params
  if (!id || (action !== 'preview' && action !== 'download')) {
    return new Response('Acción inválida', { status: 400 })
  }

  const res = await fetch(`${API_URL}/employee-files/attachments/${id}/${action}`, {
    headers: { Cookie: `auth=${identity.raw}`, 'X-Tenant': tenant },
  })
  if (res.status === 401) return redirect('/login')
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    return new Response(text || `HTTP ${res.status}`, { status: res.status })
  }

  const bytes = new Uint8Array(await res.arrayBuffer())
  const responseHeaders: Record<string, string> = {
    'Content-Type': res.headers.get('Content-Type') ?? 'application/octet-stream',
    'Content-Length': String(bytes.byteLength),
  }
  const cd = res.headers.get('Content-Disposition')
  if (cd) responseHeaders['Content-Disposition'] = cd
  return new Response(bytes as unknown as BodyInit, { status: 200, headers: responseHeaders })
}
