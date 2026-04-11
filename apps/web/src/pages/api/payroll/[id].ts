import type { APIRoute } from 'astro'

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'
const TENANT = 'demo'

export const POST: APIRoute = async ({ request, cookies, params, redirect }) => {
  const authCookie = cookies.get('auth')?.value
  if (!authCookie) return redirect('/login')

  const { id } = params
  const form = await request.formData()
  const method = form.get('_method')?.toString() ?? 'PUT'

  // ── DELETE (borrar borrador) ───────────────────────────────────────────────
  if (method === 'DELETE') {
    try {
      const res = await fetch(`${API_URL}/payroll/${id}`, {
        method: 'DELETE',
        headers: { Cookie: `auth=${authCookie}`, 'X-Tenant': TENANT },
      })
      if (res.status === 401) return redirect('/login')
    } catch {
      return redirect(`/payroll/${id}?error=server-error`)
    }
    return redirect('/payroll')
  }

  // ── PROCESS (calcular planilla) ───────────────────────────────────────────
  if (method === 'PROCESS') {
    let res: Response
    try {
      res = await fetch(`${API_URL}/payroll/${id}/process`, {
        method: 'POST',
        headers: { Cookie: `auth=${authCookie}`, 'X-Tenant': TENANT },
      })
    } catch {
      return redirect(`/payroll/${id}?error=server-error`)
    }
    if (res.status === 401) return redirect('/login')
    if (res.ok) return redirect(`/payroll/${id}?success=1`)
    const data = (await res.json().catch(() => ({}))) as { error?: string }
    const msg = encodeURIComponent(data.error ?? 'server-error')
    return redirect(`/payroll/${id}?error=${msg}`)
  }

  // ── CLOSE (marcar como pagada) ────────────────────────────────────────────
  if (method === 'CLOSE') {
    let res: Response
    try {
      res = await fetch(`${API_URL}/payroll/${id}/close`, {
        method: 'POST',
        headers: { Cookie: `auth=${authCookie}`, 'X-Tenant': TENANT },
      })
    } catch {
      return redirect(`/payroll/${id}?error=server-error`)
    }
    if (res.status === 401) return redirect('/login')
    return redirect(`/payroll/${id}`)
  }

  // ── PUT (editar nombre/fecha de pago) ─────────────────────────────────────
  const g = (k: string) => form.get(k)?.toString().trim() ?? ''
  const body = {
    name: g('name') || undefined,
    paymentDate: g('paymentDate') || null,
  }

  let res: Response
  try {
    res = await fetch(`${API_URL}/payroll/${id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `auth=${authCookie}`,
        'X-Tenant': TENANT,
      },
      body: JSON.stringify(body),
    })
  } catch {
    return redirect(`/payroll/${id}?error=server-error`)
  }

  if (res.status === 401) return redirect('/login')
  if (res.ok) return redirect(`/payroll/${id}?success=1`)
  return redirect(`/payroll/${id}?error=server-error`)
}
