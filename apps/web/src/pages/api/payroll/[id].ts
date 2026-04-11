import type { APIRoute } from 'astro'

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'
const TENANT = 'demo'

export const POST: APIRoute = async ({ request, cookies, params, redirect }) => {
  const authCookie = cookies.get('auth')?.value
  if (!authCookie) return redirect('/login')

  const { id } = params
  const form = await request.formData()
  const method = form.get('_method')?.toString() ?? 'PUT'

  const headers = { Cookie: `auth=${authCookie}`, 'X-Tenant': TENANT }

  // ── DELETE ────────────────────────────────────────────────────────────────────
  if (method === 'DELETE') {
    try {
      const res = await fetch(`${API_URL}/payroll/${id}`, { method: 'DELETE', headers })
      if (res.status === 401) return redirect('/login')
    } catch {
      return redirect(`/payroll/${id}?error=server-error`)
    }
    return redirect('/payroll')
  }

  // ── GENERATE (created → generated) ───────────────────────────────────────────
  if (method === 'GENERATE' || method === 'PROCESS') {
    let res: Response
    try {
      res = await fetch(`${API_URL}/payroll/${id}/generate`, { method: 'POST', headers })
    } catch {
      return redirect(`/payroll/${id}?error=server-error`)
    }
    if (res.status === 401) return redirect('/login')
    if (res.ok) return redirect(`/payroll/${id}?success=1`)
    const data = (await res.json().catch(() => ({}))) as { error?: string }
    return redirect(`/payroll/${id}?error=${encodeURIComponent(data.error ?? 'server-error')}`)
  }

  // ── REGENERATE (generated → generated) ───────────────────────────────────────
  if (method === 'REGENERATE') {
    let res: Response
    try {
      res = await fetch(`${API_URL}/payroll/${id}/regenerate`, { method: 'POST', headers })
    } catch {
      return redirect(`/payroll/${id}?error=server-error`)
    }
    if (res.status === 401) return redirect('/login')
    if (res.ok) return redirect(`/payroll/${id}?success=1`)
    const data = (await res.json().catch(() => ({}))) as { error?: string }
    return redirect(`/payroll/${id}?error=${encodeURIComponent(data.error ?? 'server-error')}`)
  }

  // ── CLOSE (generated → closed) ────────────────────────────────────────────────
  if (method === 'CLOSE') {
    let res: Response
    try {
      res = await fetch(`${API_URL}/payroll/${id}/close`, { method: 'POST', headers })
    } catch {
      return redirect(`/payroll/${id}?error=server-error`)
    }
    if (res.status === 401) return redirect('/login')
    return redirect(`/payroll/${id}`)
  }

  // ── REOPEN (closed → generated) ──────────────────────────────────────────────
  if (method === 'REOPEN') {
    let res: Response
    try {
      res = await fetch(`${API_URL}/payroll/${id}/reopen`, { method: 'POST', headers })
    } catch {
      return redirect(`/payroll/${id}?error=server-error`)
    }
    if (res.status === 401) return redirect('/login')
    return redirect(`/payroll/${id}`)
  }

  // ── PUT (edit name / payment date — only for created payrolls) ────────────────
  const g = (k: string) => form.get(k)?.toString().trim() ?? ''
  const body = {
    name: g('name') || undefined,
    paymentDate: g('paymentDate') || null,
  }

  let res: Response
  try {
    res = await fetch(`${API_URL}/payroll/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    })
  } catch {
    return redirect(`/payroll/${id}?error=server-error`)
  }

  if (res.status === 401) return redirect('/login')
  if (res.ok) return redirect(`/payroll/${id}?success=1`)
  return redirect(`/payroll/${id}?error=server-error`)
}
