import type { APIRoute } from 'astro'

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'
const TENANT = 'demo'

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const authCookie = cookies.get('auth')?.value
  if (!authCookie) return redirect('/login')

  const form = await request.formData()
  const g = (k: string) => form.get(k)?.toString().trim() ?? ''

  const body = {
    code: g('code'),
    name: g('name'),
    parentId: g('parentId') || null,
  }

  if (!body.code || !body.name) return redirect('/config/departamentos/new?error=missing-fields')

  let res: Response
  try {
    res = await fetch(`${API_URL}/departamentos`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `auth=${authCookie}`,
        'X-Tenant': TENANT,
      },
      body: JSON.stringify(body),
    })
  } catch {
    return redirect('/config/departamentos/new?error=server-error')
  }

  if (res.status === 401) return redirect('/login')
  if (res.ok) return redirect('/config/departamentos?success=1')

  const data = (await res.json().catch(() => ({}))) as { error?: string }
  const msg = data.error ?? ''

  if (msg.toLowerCase().includes('code') || res.status === 409) {
    return redirect('/config/departamentos/new?error=code_taken')
  }
  return redirect('/config/departamentos/new?error=server-error')
}
