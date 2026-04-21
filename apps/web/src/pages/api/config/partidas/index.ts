import type { APIRoute } from 'astro'

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'
const TENANT = 'demo'

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const authCookie = cookies.get('auth')?.value
  if (!authCookie) return redirect('/login')

  const form = await request.formData()
  const g = (k: string) => form.get(k)?.toString().trim() ?? ''

  const body = { code: g('code'), name: g('name') }

  if (!body.code || !body.name) {
    return redirect('/config/partidas/new?error=missing-fields')
  }

  let res: Response
  try {
    res = await fetch(`${API_URL}/partidas`, {
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
