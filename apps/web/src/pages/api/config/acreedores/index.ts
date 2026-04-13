import type { APIRoute } from 'astro'

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'
const TENANT = 'demo'

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const authCookie = cookies.get('auth')?.value
  if (!authCookie) return redirect('/login')

  const form = await request.formData()
  const code = form.get('code')?.toString().trim() ?? ''
  const name = form.get('name')?.toString().trim() ?? ''

  if (!code || !name) {
    return redirect('/config/acreedores/new?error=missing-fields')
  }

  let res: Response
  try {
    res = await fetch(`${API_URL}/creditors`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `auth=${authCookie}`,
        'X-Tenant': TENANT,
      },
      body: JSON.stringify({ code, name }),
    })
  } catch {
    return redirect('/config/acreedores/new?error=server-error')
  }

  if (res.status === 401) return redirect('/login')
  if (res.ok) return redirect('/config/acreedores?success=1')

  const data = (await res.json().catch(() => ({}))) as { error?: string }
  const msg = (data.error ?? '').toLowerCase()

  if (res.status === 409 || msg.includes('código') || msg.includes('code')) {
    if (msg.includes('concepto')) {
      return redirect('/config/acreedores/new?error=concept_code_taken')
    }
    return redirect('/config/acreedores/new?error=code_taken')
  }
  return redirect('/config/acreedores/new?error=server-error')
}
