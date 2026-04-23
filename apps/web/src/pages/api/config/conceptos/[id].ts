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
      const res = await fetch(`${API_URL}/concepts/${id}`, {
        method: 'DELETE',
        headers: { Cookie: `auth=${authCookie}`, 'X-Tenant': TENANT },
      })
      if (res.status === 401) return redirect('/login')
    } catch {
      return redirect(`/config/conceptos/${id}?error=server-error`)
    }
    return redirect('/config/conceptos')
  }

  if (method === 'ACTIVATE') {
    try {
      const res = await fetch(`${API_URL}/concepts/${id}/activate`, {
        method: 'POST',
        headers: { Cookie: `auth=${authCookie}`, 'X-Tenant': TENANT },
      })
      if (res.status === 401) return redirect('/login')
    } catch {
      return redirect(`/config/conceptos/${id}?error=server-error`)
    }
    return redirect(`/config/conceptos/${id}?success=1`)
  }

  // PUT — update concept with all fields
  const g = (k: string) => form.get(k)?.toString().trim() ?? ''
  const bool = (k: string) => form.get(k) === '1'

  const code = g('code')
  const name = g('name')
  const type = g('type')

  if (!code || !name || !type) {
    return redirect(`/config/conceptos/${id}?error=missing-fields`)
  }

  const body = {
    code,
    name,
    type,
    formula: g('formula') || null,
    unit: g('unit') || 'amount',
    printDetails: bool('printDetails'),
    prorates: bool('prorates'),
    allowModify: bool('allowModify'),
    isReferenceValue: bool('isReferenceValue'),
    useAmountCalc: bool('useAmountCalc'),
    allowZero: bool('allowZero'),
    cuentaContableId: g('cuentaContableId') || null,
    links: {
      payrollTypeIds: form.getAll('payrollTypeIds[]').map(String),
      frequencyIds: form.getAll('frequencyIds[]').map(String),
      situationIds: form.getAll('situationIds[]').map(String),
      accumulatorIds: form.getAll('accumulatorIds[]').map(String),
    },
  }

  let res: Response
  try {
    res = await fetch(`${API_URL}/concepts/${id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `auth=${authCookie}`,
        'X-Tenant': TENANT,
      },
      body: JSON.stringify(body),
    })
  } catch {
    return redirect(`/config/conceptos/${id}?error=server-error`)
  }

  if (res.status === 401) return redirect('/login')
  if (res.ok) return redirect(`/config/conceptos/${id}?success=1`)

  const data = (await res.json().catch(() => ({}))) as { error?: string }
  const msg = data.error ?? ''

  if (msg.toLowerCase().includes('code') || res.status === 409) {
    return redirect(`/config/conceptos/${id}?error=code_taken`)
  }
  if (msg.toLowerCase().includes('type')) {
    return redirect(`/config/conceptos/${id}?error=invalid_type`)
  }
  return redirect(`/config/conceptos/${id}?error=server-error`)
}
