import type { APIRoute } from 'astro'

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'
const TENANT = 'demo'

const VALID_KINDS = ['payroll-types', 'frequencies', 'situations', 'accumulators']

export const POST: APIRoute = async ({ request, cookies, params, redirect }) => {
  const authCookie = cookies.get('auth')?.value
  if (!authCookie) return redirect('/login')

  const { kind, id } = params
  if (!VALID_KINDS.includes(kind ?? ''))
    return redirect('/config/catalogo-conceptos?error=server-error')

  const form = await request.formData()
  const method = form.get('_method')?.toString() ?? 'PUT'
  const tab = form.get('_tab')?.toString() ?? 'payrollTypes'
  const g = (k: string) => form.get(k)?.toString().trim() ?? ''

  if (method === 'DELETE') {
    try {
      const res = await fetch(`${API_URL}/concepts/config/${kind}/${id}`, {
        method: 'DELETE',
        headers: { Cookie: `auth=${authCookie}`, 'X-Tenant': TENANT },
      })
      if (res.status === 401) return redirect('/login')
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        const errCode =
          data.error?.includes('uso') || res.status === 409 ? 'has_links' : 'server-error'
        return redirect(`/config/catalogo-conceptos?tab=${tab}&error=${errCode}`)
      }
    } catch {
      return redirect(`/config/catalogo-conceptos?tab=${tab}&error=server-error`)
    }
    return redirect(`/config/catalogo-conceptos?tab=${tab}&success=1`)
  }

  // PUT
  const body: Record<string, unknown> = { name: g('name') }
  const sortVal = g('sortOrder')
  if (sortVal !== '') body.sortOrder = Number.parseInt(sortVal, 10)

  if (!body.name) {
    return redirect(`/config/catalogo-conceptos?tab=${tab}&error=missing-fields`)
  }

  let res: Response
  try {
    res = await fetch(`${API_URL}/concepts/config/${kind}/${id}`, {
      method: 'PUT',
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

  return redirect(`/config/catalogo-conceptos?tab=${tab}&error=server-error`)
}
