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
      const res = await fetch(`${API_URL}/job-titles/${id}`, {
        method: 'DELETE',
        headers: { Cookie: `auth=${authCookie}`, 'X-Tenant': TENANT },
      })
      if (res.status === 401) return redirect('/login')
      if (res.status === 409) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        return redirect(
          `/config/job-titles?deleteError=in_use&msg=${encodeURIComponent(data.error ?? '')}`
        )
      }
      if (!res.ok) return redirect('/config/job-titles?deleteError=server-error')
    } catch {
      return redirect(`/config/job-titles/${id}?error=server-error`)
    }
    return redirect('/config/job-titles?deleted=1')
  }

  const g = (k: string) => form.get(k)?.toString().trim() ?? ''
  const body = {
    code: g('code'),
    name: g('name'),
    description: g('description') || null,
  }

  if (!body.code || !body.name) return redirect(`/config/job-titles/${id}?error=missing-fields`)

  let res: Response
  try {
    res = await fetch(`${API_URL}/job-titles/${id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `auth=${authCookie}`,
        'X-Tenant': TENANT,
      },
      body: JSON.stringify(body),
    })
  } catch {
    return redirect(`/config/job-titles/${id}?error=server-error`)
  }

  if (res.status === 401) return redirect('/login')
  if (res.ok) return redirect(`/config/job-titles/${id}?success=1`)

  const data = (await res.json().catch(() => ({}))) as { error?: string }
  const msg = data.error ?? ''

  if (msg.toLowerCase().includes('code') || res.status === 409) {
    return redirect(`/config/job-titles/${id}?error=code_taken`)
  }
  return redirect(`/config/job-titles/${id}?error=server-error`)
}
