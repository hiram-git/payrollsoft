import type { APIRoute } from 'astro'

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'
const TENANT = 'demo' // TODO: read from session when multi-tenant UI is wired

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const authCookie = cookies.get('auth')?.value
  if (!authCookie) return redirect('/login')

  const form = await request.formData()
  const g = (k: string) => form.get(k)?.toString().trim() ?? ''

  const payrollTypeIds = form.getAll('payrollTypeIds[]').map(String).filter(Boolean)

  const body = {
    code: g('code'),
    firstName: g('firstName'),
    lastName: g('lastName'),
    idNumber: g('idNumber'),
    socialSecurityNumber: g('socialSecurityNumber') || null,
    email: g('email') || null,
    phone: g('phone') || null,
    positionId: g('positionId') || null,
    cargoId: g('cargoId') || null,
    funcionId: g('funcionId') || null,
    departamentoId: g('departamentoId') || null,
    hireDate: g('hireDate'),
    baseSalary: g('baseSalary'),
    payFrequency: (g('payFrequency') || 'biweekly') as 'biweekly' | 'monthly' | 'weekly',
    payrollTypeIds: payrollTypeIds.length > 0 ? payrollTypeIds : undefined,
  }

  // Basic required-field check
  if (
    !body.code ||
    !body.firstName ||
    !body.lastName ||
    !body.idNumber ||
    !body.hireDate ||
    !body.baseSalary
  ) {
    return redirect('/employees/new?error=missing-fields')
  }

  let res: Response
  try {
    res = await fetch(`${API_URL}/employees`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `auth=${authCookie}`,
        'X-Tenant': TENANT,
      },
      body: JSON.stringify(body),
    })
  } catch {
    return redirect('/employees/new?error=server-error')
  }

  if (res.ok) {
    return redirect('/employees')
  }

  const data = (await res.json().catch(() => ({}))) as { error?: string }
  const msg = data.error ?? ''

  if (msg.toLowerCase().includes('code') || res.status === 409) {
    return redirect('/employees/new?error=code_taken')
  }
  if (msg.toLowerCase().includes('cédula') || msg.toLowerCase().includes('id number')) {
    return redirect('/employees/new?error=id_taken')
  }
  return redirect('/employees/new?error=server-error')
}
