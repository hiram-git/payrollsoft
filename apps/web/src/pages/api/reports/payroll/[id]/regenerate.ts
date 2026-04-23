import type { APIRoute } from 'astro'

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'
const TENANT = 'demo'

/**
 * Two-step regenerate: flip the state row to `not_generated` first, then
 * forward the request into the generate endpoint (which renders the PDF,
 * overwrites the file and flips the row back to `generated`).
 *
 * Splitting the transitions this way keeps the DB row honest if the render
 * step fails mid-way — the UI can detect a row stuck in `not_generated`
 * and offer a retry.
 */
export const POST: APIRoute = async ({ params, cookies, request, url, redirect }) => {
  const authCookie = cookies.get('auth')?.value
  if (!authCookie) return redirect('/login')

  const { id } = params
  if (!id) return new Response('ID de planilla requerido', { status: 400 })

  const resetRes = await fetch(`${API_URL}/payroll/${id}/report/regenerate`, {
    method: 'POST',
    headers: { Cookie: `auth=${authCookie}`, 'X-Tenant': TENANT },
  })
  if (resetRes.status === 401) return redirect('/login')
  if (!resetRes.ok) {
    const text = await resetRes.text().catch(() => '')
    console.error('Report regenerate reset failed:', resetRes.status, text)
    return new Response('No se pudo reiniciar el estado del reporte', { status: 500 })
  }

  // Re-dispatch to our own /generate handler so the render + filters + write
  // + persist logic stays in a single place.
  const generateUrl = new URL(`/api/reports/payroll/${id}/generate`, url)
  for (const [k, v] of url.searchParams) generateUrl.searchParams.set(k, v)

  return fetch(generateUrl, {
    method: 'POST',
    headers: request.headers,
  })
}
