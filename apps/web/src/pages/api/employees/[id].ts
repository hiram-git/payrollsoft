import type { APIRoute } from 'astro'

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'
const TENANT = 'demo'

export const POST: APIRoute = async ({ request, cookies, params, redirect }) => {
  const authCookie = cookies.get('auth')?.value
  if (!authCookie) return redirect('/login')

  const { id } = params
  const form = await request.formData()
  const method = form.get('_method')?.toString() ?? 'PUT'

  // ── DELETE (deactivate) ───────────────────────────────────────────────────────
  if (method === 'DELETE') {
    try {
      const res = await fetch(`${API_URL}/employees/${id}`, {
        method: 'DELETE',
        headers: { Cookie: `auth=${authCookie}`, 'X-Tenant': TENANT },
      })
      if (res.status === 401) return redirect('/login')
    } catch {
      return redirect(`/employees/${id}?error=server-error`)
    }
    return redirect('/employees')
  }

  // ── PUT (update) ──────────────────────────────────────────────────────────────
  const g = (k: string) => form.get(k)?.toString().trim() ?? ''
  const payrollTypeIds = form.getAll('payrollTypeIds[]').map(String).filter(Boolean)

  const body: Record<string, unknown> = {
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
    payFrequency: g('payFrequency') || 'biweekly',
    payrollTypeIds,
  }

  if (
    !body.code ||
    !body.firstName ||
    !body.lastName ||
    !body.idNumber ||
    !body.hireDate ||
    !body.baseSalary
  ) {
    return redirect(`/employees/${id}?error=missing-fields`)
  }

  let res: Response
  try {
    res = await fetch(`${API_URL}/employees/${id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `auth=${authCookie}`,
        'X-Tenant': TENANT,
      },
      body: JSON.stringify(body),
    })
  } catch {
    return redirect(`/employees/${id}?error=server-error`)
  }

  if (res.status === 401) return redirect('/login')

  if (res.ok) {
    return redirect(`/employees/${id}?success=1`)
  }

  const data = (await res.json().catch(() => ({}))) as { error?: string }
  const msg = data.error ?? ''

  if (msg.toLowerCase().includes('code') || res.status === 409) {
    return redirect(`/employees/${id}?error=code_taken`)
  }
  if (msg.toLowerCase().includes('cédula') || msg.toLowerCase().includes('id number')) {
    return redirect(`/employees/${id}?error=id_taken`)
  }
  return redirect(`/employees/${id}?error=server-error`)
}
