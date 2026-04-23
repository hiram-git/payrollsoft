import type { APIRoute } from 'astro'

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'
const TENANT = 'demo'

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const authCookie = cookies.get('auth')?.value
  if (!authCookie) return redirect('/login')

  const form = await request.formData()
  const g = (k: string) => form.get(k)?.toString().trim() ?? ''
  const bool = (k: string) => form.get(k) === '1'

  const code = g('code')
  const name = g('name')
  const type = g('type')

  if (!code || !name || !type) {
    return redirect('/config/conceptos/new?error=missing-fields')
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
    res = await fetch(`${API_URL}/concepts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `auth=${authCookie}`,
        'X-Tenant': TENANT,
      },
      body: JSON.stringify(body),
    })
  } catch {
    return redirect('/config/conceptos/new?error=server-error')
  }

  if (res.status === 401) return redirect('/login')
  if (res.ok) return redirect('/config/conceptos?success=1')

  const data = (await res.json().catch(() => ({}))) as { error?: string }
  const msg = data.error ?? ''

  if (msg.toLowerCase().includes('code') || res.status === 409) {
    return redirect('/config/conceptos/new?error=code_taken')
  }
  if (msg.toLowerCase().includes('type')) {
    return redirect('/config/conceptos/new?error=invalid_type')
  }
  return redirect('/config/conceptos/new?error=server-error')
}
