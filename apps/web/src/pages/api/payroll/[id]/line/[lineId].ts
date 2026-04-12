import type { APIRoute } from 'astro'

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'
const TENANT = 'demo'

export const POST: APIRoute = async ({ request, cookies, params, redirect }) => {
  const authCookie = cookies.get('auth')?.value
  if (!authCookie) return redirect('/login')

  const { id, lineId } = params
  const form = await request.formData()
  const method = form.get('_method')?.toString() ?? ''

  const headers = { Cookie: `auth=${authCookie}`, 'X-Tenant': TENANT }

  if (method === 'REGENERATE') {
    let res: Response
    try {
      res = await fetch(`${API_URL}/payroll/${id}/lines/${lineId}/regenerate`, {
        method: 'POST',
        headers,
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'No se pudo conectar con el servidor API'
      return redirect(`/payroll/${id}/${lineId}?error=${encodeURIComponent(msg)}`)
    }
    if (res.status === 401) return redirect('/login')
    if (res.ok) return redirect(`/payroll/${id}/${lineId}?success=1`)
    const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string }
    const msg = data.error ?? data.message ?? `HTTP ${res.status}`
    return redirect(`/payroll/${id}/${lineId}?error=${encodeURIComponent(msg)}`)
  }

  return redirect(`/payroll/${id}/${lineId}`)
}
