import type { APIRoute } from 'astro'

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'
const TENANT = 'demo'

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const authCookie = cookies.get('auth')?.value
  if (!authCookie) return redirect('/login')

  const form = await request.formData()
  const g = (k: string) => form.get(k)?.toString().trim() ?? ''

  const body = {
    name: g('name'),
    type: g('type'),
    frequency: g('frequency'),
    periodStart: g('periodStart'),
    periodEnd: g('periodEnd'),
    paymentDate: g('paymentDate') || null,
    payrollTypeId: g('payrollTypeId') || null,
  }

  if (!body.name || !body.type || !body.frequency || !body.periodStart || !body.periodEnd) {
    return redirect('/payroll/new?error=missing-fields')
  }

  let res: Response
  try {
    res = await fetch(`${API_URL}/payroll`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `auth=${authCookie}`,
        'X-Tenant': TENANT,
      },
      body: JSON.stringify(body),
    })
  } catch {
    return redirect('/payroll/new?error=server-error')
  }

  if (res.status === 401) return redirect('/login')
  if (res.ok) {
    const data = (await res.json()) as { data: { id: string } }
    return redirect(`/payroll/${data.data.id}`)
  }

  const data = (await res.json().catch(() => ({}))) as { error?: string }
  const msg = data.error ?? ''
  if (msg.includes('period')) return redirect('/payroll/new?error=invalid_period')
  if (msg.includes('type')) return redirect('/payroll/new?error=invalid_type')
  if (msg.includes('freq')) return redirect('/payroll/new?error=invalid_freq')
  return redirect('/payroll/new?error=server-error')
}
