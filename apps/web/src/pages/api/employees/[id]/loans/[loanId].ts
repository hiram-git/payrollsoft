import type { APIRoute } from 'astro'

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'
const TENANT = 'demo'

export const POST: APIRoute = async ({ request, cookies, params, redirect }) => {
  const authCookie = cookies.get('auth')?.value
  if (!authCookie) return redirect('/login')

  const { id, loanId } = params
  const form = await request.formData()
  const method = form.get('_method')?.toString() ?? 'PUT'

  if (method === 'DELETE') {
    try {
      const res = await fetch(`${API_URL}/loans/${loanId}`, {
        method: 'DELETE',
        headers: { Cookie: `auth=${authCookie}`, 'X-Tenant': TENANT },
      })
      if (res.status === 401) return redirect('/login')
    } catch {
      return redirect(`/employees/${id}/loans/${loanId}?error=server-error`)
    }
    return redirect(`/employees/${id}`)
  }

  const g = (k: string) => form.get(k)?.toString().trim() ?? ''

  const amount = g('amount')
  const balance = g('balance')
  const installment = g('installment')
  const startDate = g('startDate')
  const endDate = g('endDate') || null

  if (!amount || !balance || !installment || !startDate) {
    return redirect(`/employees/${id}/loans/${loanId}?error=missing-fields`)
  }

  const body = { amount, balance, installment, startDate, endDate }

  let res: Response
  try {
    res = await fetch(`${API_URL}/loans/${loanId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `auth=${authCookie}`,
        'X-Tenant': TENANT,
      },
      body: JSON.stringify(body),
    })
  } catch {
    return redirect(`/employees/${id}/loans/${loanId}?error=server-error`)
  }

  if (res.status === 401) return redirect('/login')
  if (res.ok) return redirect(`/employees/${id}/loans/${loanId}?success=1`)
  return redirect(`/employees/${id}/loans/${loanId}?error=server-error`)
}
