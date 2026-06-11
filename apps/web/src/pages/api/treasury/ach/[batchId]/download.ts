/**
 * GET /api/treasury/ach/:batchId/download
 *
 * Descarga el archivo de un lote ACH ya generado. Reenvía la respuesta del
 * API con auth + tenant, preservando los bytes (incluido el Latin-1 de
 * Banco Nacional) y las cabeceras de descarga.
 */
import type { APIRoute } from 'astro'
import { getIdentity } from '../../../../../lib/auth'

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'

export const GET: APIRoute = async ({ params, cookies, redirect }) => {
  const identity = getIdentity(cookies)
  if (!identity) return redirect('/login')
  const tenant = identity.tenantSlug ?? 'demo'
  const headers = { Cookie: `auth=${identity.raw}`, 'X-Tenant': tenant }

  const batchId = params.batchId ?? ''
  const res = await fetch(`${API_URL}/treasury/ach/${batchId}/download`, { headers })
  if (!res.ok) return new Response('Archivo no encontrado', { status: res.status })

  const buffer = await res.arrayBuffer()
  return new Response(buffer, {
    status: 200,
    headers: {
      'Content-Type': res.headers.get('Content-Type') ?? 'text/plain',
      'Content-Disposition':
        res.headers.get('Content-Disposition') ?? `attachment; filename="ach-${batchId}.txt"`,
      'Content-Length': String(buffer.byteLength),
    },
  })
}
