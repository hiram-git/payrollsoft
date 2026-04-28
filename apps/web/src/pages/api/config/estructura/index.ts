import type { APIRoute } from 'astro'

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'
const TENANT = 'demo'

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const authCookie = cookies.get('auth')?.value
  if (!authCookie) return redirect('/login')

  const form = await request.formData()
  const g = (k: string) => form.get(k)?.toString().trim() ?? ''

  const status = g('status')
  const body = {
    code: g('code'),
    name: g('name'),
    salary: g('salary'),
    cargoId: g('cargoId') || null,
    departamentoId: g('departamentoId') || null,
    funcionId: g('funcionId') || null,
    partidaId: g('partidaId') || null,
    status: status === 'en_uso' || status === 'vacante' ? status : 'vacante',
  }

  if (!body.code || !body.name || !body.salary) {
    return redirect('/config/estructura/new?error=missing-fields')
  }

  let res: Response
  try {
    res = await fetch(`${API_URL}/positions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `auth=${authCookie}`,
        'X-Tenant': TENANT,
      },
      body: JSON.stringify(body),
    })
  } catch {
    return redirect('/config/estructura/new?error=server-error')
  }

  if (res.status === 401) return redirect('/login')
  if (res.ok) return redirect('/config/estructura?success=1')

  const data = (await res.json().catch(() => ({}))) as { error?: string }
  if (res.status === 409 || data.error === 'code_taken') {
    return redirect('/config/estructura/new?error=code_taken')
  }
  return redirect('/config/estructura/new?error=server-error')
}
