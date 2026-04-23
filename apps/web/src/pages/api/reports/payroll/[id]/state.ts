import type { APIRoute } from 'astro'

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'
const TENANT = 'demo'

/**
 * Thin proxy to the API's GET /payroll/:id/report. The client-side script
 * on /payroll/[id] hits this after a regenerate so the `Descargar/Regenerar`
 * buttons can be refreshed without a full page reload.
 */
export const GET: APIRoute = async ({ params, cookies, redirect }) => {
  const authCookie = cookies.get('auth')?.value
  if (!authCookie) return redirect('/login')

  const { id } = params
  if (!id) return new Response('ID de planilla requerido', { status: 400 })

  const res = await fetch(`${API_URL}/payroll/${id}/report`, {
    headers: { Cookie: `auth=${authCookie}`, 'X-Tenant': TENANT },
  })

  return new Response(await res.text(), {
    status: res.status,
    headers: { 'Content-Type': res.headers.get('Content-Type') ?? 'application/json' },
  })
}
