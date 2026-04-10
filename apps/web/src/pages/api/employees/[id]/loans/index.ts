import type { APIRoute } from 'astro'

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'
const TENANT = 'demo'

export const POST: APIRoute = async ({ request, cookies, params, redirect }) => {
  const authCookie = cookies.get('auth')?.value
  if (!authCookie) return redirect('/login')

  const { id } = params
  const form = await request.formData()
  const g = (k: string) => form.get(k)?.toString().trim() ?? ''

  const amount = g('amount')
  const installment = g('installment')
  const startDate = g('startDate')
  const endDate = g('endDate') || null

  if (!amount || !installment || !startDate) {
    return redirect(`/employees/${id}/loans/new?error=missing-fields`)
  }

  const body = {
    employeeId: id,
    amount,
    balance: amount, // initial balance equals the full amount
    installment,
    startDate,
    endDate,
  }

  let res: Response
  try {
    res = await fetch(`${API_URL}/loans`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `auth=${authCookie}`,
        'X-Tenant': TENANT,
      },
      body: JSON.stringify(body),
    })
  } catch {
    return redirect(`/employees/${id}/loans/new?error=server-error`)
  }

  if (res.status === 401) return redirect('/login')
  if (res.ok) return redirect(`/employees/${id}`)
  return redirect(`/employees/${id}/loans/new?error=server-error`)
}
