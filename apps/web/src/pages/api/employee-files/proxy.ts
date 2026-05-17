/**
 * Proxy genérico para los endpoints GET del módulo de expedientes.
 * Reenvía la sub-ruta tal cual al API, forwardeando auth + tenant.
 *
 * Usado desde el formulario cliente para:
 *   - GET types/:typeId/subtypes
 *   - GET fields?typeId=…&subtypeId=…
 *   - GET next-number?…
 *
 * Limitado a paths de solo lectura (catálogo/preview). Las
 * operaciones de escritura van por `save.ts`.
 */
import type { APIRoute } from 'astro'
import { getIdentity } from '../../../lib/auth'

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'

const ALLOWED_PREFIXES = ['types', 'fields', 'next-number']

export const GET: APIRoute = async ({ request, cookies }) => {
  const identity = getIdentity(cookies)
  if (!identity) return new Response('Unauthorized', { status: 401 })
  const tenant = identity.tenantSlug ?? 'demo'

  const url = new URL(request.url)
  const rawPath = (url.searchParams.get('path') ?? '').trim()
  if (!rawPath) return new Response('Falta `path`', { status: 400 })
  if (
    !ALLOWED_PREFIXES.some(
      (p) => rawPath === p || rawPath.startsWith(`${p}/`) || rawPath.startsWith(`${p}?`)
    )
  ) {
    return new Response('Path no permitido', { status: 403 })
  }

  const res = await fetch(`${API_URL}/employee-files/${rawPath}`, {
    headers: { Cookie: `auth=${identity.raw}`, 'X-Tenant': tenant },
  })
  const body = await res.text()
  return new Response(body, {
    status: res.status,
    headers: { 'Content-Type': res.headers.get('content-type') ?? 'application/json' },
  })
}
