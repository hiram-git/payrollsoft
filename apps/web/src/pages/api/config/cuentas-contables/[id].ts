import type { APIRoute } from 'astro'

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'
const TENANT = 'demo'

export const POST: APIRoute = async ({ request, cookies, params, redirect }) => {
  const authCookie = cookies.get('auth')?.value
  if (!authCookie) return redirect('/login')

  const { id } = params
  const form = await request.formData()
  const method = form.get('_method')?.toString() ?? 'PUT'

  if (method === 'DELETE') {
    try {
      const res = await fetch(`${API_URL}/cuentas-contables/${id}`, {
        method: 'DELETE',
        headers: { Cookie: `auth=${authCookie}`, 'X-Tenant': TENANT },
      })
      if (res.status === 401) return redirect('/login')
    } catch {
      return redirect('/config/catalogo-conceptos?tab=cuentas&error=server-error')
    }
    return redirect('/config/catalogo-conceptos?tab=cuentas')
  }

  const g = (k: string) => form.get(k)?.toString().trim() ?? ''
  const body: Record<string, string> = {}
  const name = g('name')
  if (name) body.name = name

  let res: Response
  try {
    res = await fetch(`${API_URL}/cuentas-contables/${id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `auth=${authCookie}`,
        'X-Tenant': TENANT,
      },
      body: JSON.stringify(body),
    })
  } catch {
    return redirect('/config/catalogo-conceptos?tab=cuentas&error=server-error')
  }

  if (res.status === 401) return redirect('/login')
  if (res.ok) return redirect('/config/catalogo-conceptos?tab=cuentas&success=1')

  const data = (await res.json().catch(() => ({}))) as { error?: string }
  if (res.status === 409 || data.error === 'code_taken') {
    return redirect('/config/catalogo-conceptos?tab=cuentas&error=code_taken')
  }
  return redirect('/config/catalogo-conceptos?tab=cuentas&error=server-error')
}
