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
      const res = await fetch(`${API_URL}/departamentos/${id}`, {
        method: 'DELETE',
        headers: { Cookie: `auth=${authCookie}`, 'X-Tenant': TENANT },
      })
      if (res.status === 401) return redirect('/login')
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        const msg = data.error ?? ''
        if (msg.toLowerCase().includes('children') || res.status === 422) {
          return redirect(`/config/departamentos/${id}?error=has_children`)
        }
        return redirect(`/config/departamentos/${id}?error=server-error`)
      }
    } catch {
      return redirect(`/config/departamentos/${id}?error=server-error`)
    }
    return redirect('/config/departamentos')
  }

  const g = (k: string) => form.get(k)?.toString().trim() ?? ''
  const body = {
    code: g('code'),
    name: g('name'),
    parentId: g('parentId') || null,
  }

  if (!body.code || !body.name) return redirect(`/config/departamentos/${id}?error=missing-fields`)

  let res: Response
  try {
    res = await fetch(`${API_URL}/departamentos/${id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `auth=${authCookie}`,
        'X-Tenant': TENANT,
      },
      body: JSON.stringify(body),
    })
  } catch {
    return redirect(`/config/departamentos/${id}?error=server-error`)
  }

  if (res.status === 401) return redirect('/login')
  if (res.ok) return redirect(`/config/departamentos/${id}?success=1`)

  const data = (await res.json().catch(() => ({}))) as { error?: string }
  const msg = data.error ?? ''

  if (msg.toLowerCase().includes('code') || res.status === 409) {
    return redirect(`/config/departamentos/${id}?error=code_taken`)
  }
  if (msg.toLowerCase().includes('cycle') || res.status === 422) {
    return redirect(`/config/departamentos/${id}?error=cycle`)
  }
  return redirect(`/config/departamentos/${id}?error=server-error`)
}
