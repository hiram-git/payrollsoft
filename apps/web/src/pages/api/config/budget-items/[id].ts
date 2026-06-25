import type { APIRoute } from 'astro'
import { resolveTenantSlugFromCookie } from '../../../../lib/tenant-slug'

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'

export const POST: APIRoute = async ({ request, cookies, params, redirect }) => {
  const authCookie = cookies.get('auth')?.value
  if (!authCookie) return redirect('/login')
  const TENANT = resolveTenantSlugFromCookie(authCookie)

  const { id } = params
  const form = await request.formData()
  const method = form.get('_method')?.toString() ?? 'PUT'

  if (method === 'DELETE') {
    try {
      const res = await fetch(`${API_URL}/budget-items/${id}`, {
        method: 'DELETE',
        headers: { Cookie: `auth=${authCookie}`, 'X-Tenant': TENANT },
      })
      if (res.status === 401) return redirect('/login')
    } catch {
      return redirect(`/config/budget-items/${id}?error=server-error`)
    }
    return redirect('/config/budget-items')
  }

  const g = (k: string) => form.get(k)?.toString().trim() ?? ''
  const body = { code: g('code'), name: g('name') }

  if (!body.code || !body.name) {
    return redirect(`/config/budget-items/${id}?error=missing-fields`)
  }

  let res: Response
  try {
    res = await fetch(`${API_URL}/budget-items/${id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `auth=${authCookie}`,
        'X-Tenant': TENANT,
      },
      body: JSON.stringify(body),
    })
  } catch {
    return redirect(`/config/budget-items/${id}?error=server-error`)
  }

  if (res.status === 401) return redirect('/login')
  if (res.ok) return redirect(`/config/budget-items/${id}?success=1`)

  const data = (await res.json().catch(() => ({}))) as { error?: string }
  if (res.status === 409 || data.error?.includes('código')) {
    return redirect(`/config/budget-items/${id}?error=code_taken`)
  }
  return redirect(`/config/budget-items/${id}?error=server-error`)
}
