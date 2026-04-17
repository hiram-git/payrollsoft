import type { APIRoute } from 'astro'

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'
const TENANT = 'demo'

const VALID_KINDS = ['payroll-types', 'frequencies', 'situations', 'accumulators']

export const POST: APIRoute = async ({ request, cookies, params, redirect }) => {
  const authCookie = cookies.get('auth')?.value
  if (!authCookie) return redirect('/login')

  const { kind } = params
  if (!VALID_KINDS.includes(kind ?? ''))
    return redirect('/config/catalogo-conceptos?error=server-error')

  const form = await request.formData()
  const tab = form.get('_tab')?.toString() ?? 'payrollTypes'
  const g = (k: string) => form.get(k)?.toString().trim() ?? ''

  const body = {
    code: g('code'),
    name: g('name'),
    sortOrder: Number.parseInt(g('sortOrder') || '0', 10),
  }

  if (!body.code || !body.name) {
    return redirect(`/config/catalogo-conceptos?tab=${tab}&error=missing-fields`)
  }

  let res: Response
  try {
    res = await fetch(`${API_URL}/concepts/config/${kind}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `auth=${authCookie}`,
        'X-Tenant': TENANT,
      },
      body: JSON.stringify(body),
    })
  } catch {
    return redirect(`/config/catalogo-conceptos?tab=${tab}&error=server-error`)
  }

  if (res.status === 401) return redirect('/login')
  if (res.ok) return redirect(`/config/catalogo-conceptos?tab=${tab}&success=1`)

  const data = (await res.json().catch(() => ({}))) as { error?: string }
  if (res.status === 409 || data.error === 'code_taken') {
    return redirect(`/config/catalogo-conceptos?tab=${tab}&error=code_taken`)
  }
  return redirect(`/config/catalogo-conceptos?tab=${tab}&error=server-error`)
}
