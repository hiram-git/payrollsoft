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
      const res = await fetch(`${API_URL}/positions/${id}`, {
        method: 'DELETE',
        headers: { Cookie: `auth=${authCookie}`, 'X-Tenant': TENANT },
      })
      if (res.status === 401) return redirect('/login')
    } catch {
      return redirect(`/config/estructura/${id}?error=server-error`)
    }
    return redirect('/config/estructura')
  }

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
    return redirect(`/config/estructura/${id}?error=missing-fields`)
  }

  let res: Response
  try {
    res = await fetch(`${API_URL}/positions/${id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `auth=${authCookie}`,
        'X-Tenant': TENANT,
      },
      body: JSON.stringify(body),
    })
  } catch {
    return redirect(`/config/estructura/${id}?error=server-error`)
  }

  if (res.status === 401) return redirect('/login')
  if (res.ok) return redirect(`/config/estructura/${id}?success=1`)

  const data = (await res.json().catch(() => ({}))) as { error?: string }
  if (res.status === 409 || data.error === 'code_taken') {
    return redirect(`/config/estructura/${id}?error=code_taken`)
  }
  return redirect(`/config/estructura/${id}?error=server-error`)
}
