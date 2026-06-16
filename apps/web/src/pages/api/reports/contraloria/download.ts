import type { APIRoute } from 'astro'
import { resolveTenantSlugFromCookie } from '../../../../lib/tenant-slug'

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'

/**
 * Descarga los TXT de contraloría (bloqueo presupuestario por planilla o
 * mensual). Reenvía al API, que agrega por mes/año (+ tipo) sobre planillas
 * cerradas, y transmite el contenido como archivo de texto.
 */
export const GET: APIRoute = async ({ url, cookies, redirect }) => {
  const authCookie = cookies.get('auth')?.value
  if (!authCookie) return redirect('/login')
  const tenantSlug = resolveTenantSlugFromCookie(authCookie)

  const kind =
    url.searchParams.get('kind') === 'bloqueo-mensual' ? 'bloqueo-mensual' : 'bloqueo-planilla'
  const month = url.searchParams.get('month') ?? ''
  const year = url.searchParams.get('year') ?? ''
  const payrollTypeId = url.searchParams.get('payrollTypeId') ?? ''
  if (!month || !year) return new Response('month y year requeridos', { status: 400 })

  const qs = new URLSearchParams({ month, year })
  if (kind === 'bloqueo-planilla' && payrollTypeId) qs.set('payrollTypeId', payrollTypeId)

  const headers = { Cookie: `auth=${authCookie}`, 'X-Tenant': tenantSlug }
  let res: Response
  try {
    res = await fetch(`${API_URL}/treasury/contraloria/${kind}?${qs}`, { headers })
  } catch {
    return new Response('No se pudo conectar con el servidor', { status: 502 })
  }
  if (res.status === 401) return redirect('/login')

  const json = (await res.json().catch(() => ({}))) as {
    success?: boolean
    data?: { fileName: string; content: string }
    error?: string
  }
  if (!res.ok || !json.success || !json.data) {
    return new Response(json.error ?? 'No se pudo generar el reporte', {
      status: res.status || 422,
    })
  }

  return new Response(json.data.content, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': `attachment; filename="${json.data.fileName}"`,
    },
  })
}
