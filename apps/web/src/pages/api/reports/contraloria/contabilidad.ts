import type { APIRoute } from 'astro'
import { buildContabilidadTxt } from '../../../../lib/reports/contabilidad-txt'
import { resolveTenantSlugFromCookie } from '../../../../lib/tenant-slug'

/**
 * TXT de contabilidad / devengos del mes (agrega planillas cerradas).
 */
export const GET: APIRoute = async ({ url, cookies, redirect }) => {
  const authCookie = cookies.get('auth')?.value
  if (!authCookie) return redirect('/login')
  const tenantSlug = resolveTenantSlugFromCookie(authCookie)

  const month = Number(url.searchParams.get('month'))
  const year = Number(url.searchParams.get('year'))
  const payrollTypeId = url.searchParams.get('payrollTypeId') || null
  if (!month || !year) return new Response('month y year requeridos', { status: 400 })

  const result = await buildContabilidadTxt(month, year, payrollTypeId, authCookie, tenantSlug)
  if (!result.ok) {
    if (result.status === 401) return redirect('/login')
    return new Response(result.error, { status: result.status })
  }

  return new Response(result.content, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': `attachment; filename="${result.fileName}"`,
    },
  })
}
