import type { APIRoute } from 'astro'

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'
const TENANT = 'demo'

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const authCookie = cookies.get('auth')?.value
  if (!authCookie) return redirect('/login')

  const form = await request.formData()
  const g = (k: string) => form.get(k)?.toString().trim() ?? ''

  const employeeId = g('employeeId')
  const totalAmount = g('totalAmount')
  const installment = g('installment') // computed by client-side calculator
  const startDate = g('startDate')
  const endDate = g('endDate') || null
  const loanType = g('loanType') || null
  const frequency = g('frequency') || null
  const creditorId = g('creditorId') || null
  const allowDecember = form.get('allowDecember') !== null // checkbox: present = checked

  if (!employeeId || !totalAmount || !installment || !startDate) {
    return redirect('/loans/new?error=missing-fields')
  }

  const body = {
    employeeId,
    amount: totalAmount,
    balance: totalAmount, // initial balance equals the full amount
    installment,
    startDate,
    endDate,
    loanType,
    frequency,
    creditorId,
    allowDecember,
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
    return redirect('/loans/new?error=server-error')
  }

  if (res.status === 401) return redirect('/login')
  if (res.status === 404) return redirect('/loans/new?error=employee-not-found')
  if (res.ok) return redirect('/loans?success=1')
  return redirect('/loans/new?error=server-error')
}
