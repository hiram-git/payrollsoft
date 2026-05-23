import type { APIRoute } from 'astro'
import { resolveTenantSlugFromCookie } from '../../../../lib/tenant-slug'

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const authCookie = cookies.get('auth')?.value
  if (!authCookie) return redirect('/login')
  const TENANT = resolveTenantSlugFromCookie(authCookie)

  const form = await request.formData()
  const g = (k: string) => form.get(k)?.toString().trim() ?? ''

  const body = { code: g('code'), name: g('name') }

  if (!body.code || !body.name) {
    return redirect('/config/partidas/new?error=missing-fields')
  }

  let res: Response
  try {
    res = await fetch(`${API_URL}/budget-items`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `auth=${authCookie}`,
        'X-Tenant': TENANT,
      },
      body: JSON.stringify(body),
    })
  } catch {
    return redirect('/config/partidas/new?error=server-error')
  }

  if (res.status === 401) return redirect('/login')
  if (res.ok) return redirect('/config/partidas?success=1')

  const data = (await res.json().catch(() => ({}))) as { error?: string }
  if (res.status === 409 || data.error?.includes('código')) {
    return redirect('/config/partidas/new?error=code_taken')
  }
  return redirect('/config/partidas/new?error=server-error')
}
