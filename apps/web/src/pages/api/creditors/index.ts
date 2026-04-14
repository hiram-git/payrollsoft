import type { APIRoute } from 'astro'

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'
const TENANT = 'demo'

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const authCookie = cookies.get('auth')?.value
  if (!authCookie) return redirect('/login')

  const form = await request.formData()
  const g = (k: string) => form.get(k)?.toString().trim() ?? ''

  const body = {
    code: g('code').toUpperCase(),
    name: g('name'),
    description: g('description') || null,
  }

  if (!body.code || !body.name) return redirect('/creditors/new?error=missing-fields')

  let res: Response
  try {
    res = await fetch(`${API_URL}/creditors`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `auth=${authCookie}`,
        'X-Tenant': TENANT,
      },
      body: JSON.stringify(body),
    })
  } catch {
    return redirect('/creditors/new?error=server-error')
  }

  if (res.status === 401) return redirect('/login')
  if (res.ok) return redirect('/creditors?success=1')

  if (res.status === 409) return redirect('/creditors/new?error=duplicate-code')
  return redirect('/creditors/new?error=server-error')
}
