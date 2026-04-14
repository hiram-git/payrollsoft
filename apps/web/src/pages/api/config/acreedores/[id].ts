import type { APIRoute } from 'astro'

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'
const TENANT = 'demo'

export const POST: APIRoute = async ({ request, params, cookies, redirect }) => {
  const authCookie = cookies.get('auth')?.value
  if (!authCookie) return redirect('/login')

  const { id } = params
  const form = await request.formData()
  const method = form.get('_method')?.toString()

  if (method === 'PUT') {
    const name = form.get('name')?.toString().trim() ?? ''
    if (!name) {
      return redirect(`/config/acreedores/${id}?error=missing-fields`)
    }

    let res: Response
    try {
      res = await fetch(`${API_URL}/creditors/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `auth=${authCookie}`,
          'X-Tenant': TENANT,
        },
        body: JSON.stringify({ name }),
      })
    } catch {
      return redirect(`/config/acreedores/${id}?error=server-error`)
    }

    if (res.status === 401) return redirect('/login')
    if (res.ok) return redirect(`/config/acreedores/${id}?success=1`)
    return redirect(`/config/acreedores/${id}?error=server-error`)
  }

  if (method === 'DEACTIVATE') {
    try {
      await fetch(`${API_URL}/creditors/${id}/deactivate`, {
        method: 'POST',
        headers: { Cookie: `auth=${authCookie}`, 'X-Tenant': TENANT },
      })
    } catch {
      // ignore
    }
    return redirect('/config/acreedores')
  }

  if (method === 'ACTIVATE') {
    try {
      await fetch(`${API_URL}/creditors/${id}/activate`, {
        method: 'POST',
        headers: { Cookie: `auth=${authCookie}`, 'X-Tenant': TENANT },
      })
    } catch {
      // ignore
    }
    return redirect('/config/acreedores')
  }

  return redirect('/config/acreedores')
}
