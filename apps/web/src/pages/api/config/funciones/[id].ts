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
      const res = await fetch(`${API_URL}/funciones/${id}`, {
        method: 'DELETE',
        headers: { Cookie: `auth=${authCookie}`, 'X-Tenant': TENANT },
      })
      if (res.status === 401) return redirect('/login')
    } catch {
      return redirect(`/config/funciones/${id}?error=server-error`)
    }
    return redirect('/config/funciones')
  }

  const g = (k: string) => form.get(k)?.toString().trim() ?? ''
  const body = {
    code: g('code'),
    name: g('name'),
    description: g('description') || null,
  }

  if (!body.code || !body.name) return redirect(`/config/funciones/${id}?error=missing-fields`)

  let res: Response
  try {
    res = await fetch(`${API_URL}/funciones/${id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `auth=${authCookie}`,
        'X-Tenant': TENANT,
      },
      body: JSON.stringify(body),
    })
  } catch {
    return redirect(`/config/funciones/${id}?error=server-error`)
  }

  if (res.status === 401) return redirect('/login')
  if (res.ok) return redirect(`/config/funciones/${id}?success=1`)

  const data = (await res.json().catch(() => ({}))) as { error?: string }
  const msg = data.error ?? ''

  if (msg.toLowerCase().includes('code') || res.status === 409) {
    return redirect(`/config/funciones/${id}?error=code_taken`)
  }
  return redirect(`/config/funciones/${id}?error=server-error`)
}
