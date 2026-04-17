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
      const res = await fetch(`${API_URL}/attendance/shifts/${id}`, { method: 'DELETE', headers })
      if (res.status === 401) return redirect('/login')
    } catch {
      return redirect(`/attendance/shifts/${id}?error=server-error`)
    }
    return redirect('/attendance/shifts')
  }

  // ── PUT ───────────────────────────────────────────────────────────────────────
  const g = (k: string) => form.get(k)?.toString().trim() ?? ''
  const gInt = (k: string) => {
    const v = g(k)
    return v ? Number.parseInt(v, 10) : 0
  }
  const orNull = (v: string) => v || null

  const body = {
    name: g('name') || undefined,
    entryTime: g('entryTime') || undefined,
    lunchStartTime: orNull(g('lunchStartTime')),
    lunchEndTime: orNull(g('lunchEndTime')),
    exitTime: g('exitTime') || undefined,
    entryToleranceBefore: gInt('entryToleranceBefore'),
    entryToleranceAfter: gInt('entryToleranceAfter'),
    lunchStartToleranceBefore: gInt('lunchStartToleranceBefore'),
    lunchStartToleranceAfter: gInt('lunchStartToleranceAfter'),
    lunchEndToleranceBefore: gInt('lunchEndToleranceBefore'),
    lunchEndToleranceAfter: gInt('lunchEndToleranceAfter'),
    exitToleranceBefore: gInt('exitToleranceBefore'),
    exitToleranceAfter: gInt('exitToleranceAfter'),
    isDefault: g('isDefault') === 'on' || g('isDefault') === 'true',
  }

  let res: Response
  try {
    res = await fetch(`${API_URL}/attendance/shifts/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    })
  } catch {
    return redirect(`/attendance/shifts/${id}?error=server-error`)
  }

  if (res.status === 401) return redirect('/login')
  if (res.ok) return redirect(`/attendance/shifts/${id}?success=1`)

  const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string }
  const msg = encodeURIComponent(data.error ?? data.message ?? 'server-error')
  return redirect(`/attendance/shifts/${id}?error=${msg}`)
}
