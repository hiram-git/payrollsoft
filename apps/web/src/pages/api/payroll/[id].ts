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
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'No se pudo conectar con el servidor API'
      return redirect(`/payroll/${id}?error=${encodeURIComponent(msg)}`)
    }
    if (res.status === 401) return redirect('/login')
    if (res.ok) return redirect(`/payroll/${id}?success=1`)
    const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string }
    const msg = data.error ?? data.message ?? `HTTP ${res.status}`
    return redirect(`/payroll/${id}?error=${encodeURIComponent(msg)}`)
  }

  // ── REGENERATE (generated → generated) ───────────────────────────────────────
  if (method === 'REGENERATE') {
    let res: Response
    try {
      res = await fetch(`${API_URL}/payroll/${id}/regenerate`, { method: 'POST', headers })
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'No se pudo conectar con el servidor API'
      return redirect(`/payroll/${id}?error=${encodeURIComponent(msg)}`)
    }
    if (res.status === 401) return redirect('/login')
    if (res.ok) return redirect(`/payroll/${id}?success=1`)
    const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string }
    const msg = data.error ?? data.message ?? `HTTP ${res.status}`
    return redirect(`/payroll/${id}?error=${encodeURIComponent(msg)}`)
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
    if (res.ok) return redirect(`/payroll/${id}?success=1`)
    const closeData = (await res.json().catch(() => ({}))) as { error?: string; message?: string }
    const closeMsg = closeData.error ?? closeData.message ?? `HTTP ${res.status}`
    return redirect(`/payroll/${id}?error=${encodeURIComponent(closeMsg)}`)
  }

  // ── REVERT (generated → created) ─────────────────────────────────────────────
  if (method === 'REVERT') {
    let res: Response
    try {
      res = await fetch(`${API_URL}/payroll/${id}/revert`, { method: 'POST', headers })
    } catch {
      return redirect(`/payroll/${id}?error=server-error`)
    }
    if (res.status === 401) return redirect('/login')
    if (res.ok) return redirect(`/payroll/${id}`)
    const revertData = (await res.json().catch(() => ({}))) as { error?: string; message?: string }
    const revertMsg = revertData.error ?? revertData.message ?? `HTTP ${res.status}`
    return redirect(`/payroll/${id}?error=${encodeURIComponent(revertMsg)}`)
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
    if (res.ok) return redirect(`/payroll/${id}`)
    const reopenData = (await res.json().catch(() => ({}))) as { error?: string; message?: string }
    const reopenMsg = reopenData.error ?? reopenData.message ?? `HTTP ${res.status}`
    return redirect(`/payroll/${id}?error=${encodeURIComponent(reopenMsg)}`)
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
