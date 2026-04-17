import type { APIRoute } from 'astro'

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'
const TENANT = 'demo'

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const authCookie = cookies.get('auth')?.value
  if (!authCookie) return redirect('/login')

  const form = await request.formData()
  const g = (k: string) => form.get(k)?.toString().trim() ?? ''
  const gInt = (k: string) => {
    const v = g(k)
    return v ? Number.parseInt(v, 10) : 0
  }
  const orNull = (v: string) => v || null

  const body = {
    name: g('name'),
    entryTime: g('entryTime'),
    lunchStartTime: orNull(g('lunchStartTime')),
    lunchEndTime: orNull(g('lunchEndTime')),
    exitTime: g('exitTime'),
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
    res = await fetch(`${API_URL}/attendance/shifts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `auth=${authCookie}`,
        'X-Tenant': TENANT,
      },
      body: JSON.stringify(body),
    })
  } catch {
    return redirect('/attendance/shifts/new?error=server-error')
  }

  if (res.status === 401) return redirect('/login')
  if (res.ok) return redirect('/attendance/shifts')

  return redirect('/attendance/shifts/new?error=server-error')
}
