import type { APIRoute } from 'astro'

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'
const TENANT = 'demo'

export const POST: APIRoute = async ({ request, cookies, params, redirect }) => {
  const authCookie = cookies.get('auth')?.value
  if (!authCookie) return redirect('/login')

  const { id } = params
  const form = await request.formData()
  const method = form.get('_method')?.toString() ?? 'PUT'

  if (method !== 'PUT') return redirect(`/creditors/${id}?error=server-error`)

  const g = (k: string) => form.get(k)?.toString().trim() ?? ''

  const body = {
    name: g('name') || undefined,
    description: g('description') || null,
    isActive: form.get('isActive') !== null,
  }

  if (!body.name) return redirect(`/creditors/${id}?error=missing-fields`)

  let res: Response
  try {
    res = await fetch(`${API_URL}/creditors/${id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `auth=${authCookie}`,
        'X-Tenant': TENANT,
      },
      body: JSON.stringify(body),
    })
  } catch {
    return redirect(`/creditors/${id}?error=server-error`)
  }

  if (res.status === 401) return redirect('/login')
  if (res.status === 404) return redirect('/creditors')
  if (res.ok) return redirect(`/creditors/${id}?success=1`)
  return redirect(`/creditors/${id}?error=server-error`)
}
