import type { APIRoute } from 'astro'

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'
const TENANT = 'demo'

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const authCookie = cookies.get('auth')?.value
  if (!authCookie) return redirect('/login')

  const form = await request.formData()
  const g = (k: string) => form.get(k)?.toString().trim() ?? ''

  const orNull = (v: string) => v || null

  const body = {
    employeeId: g('employeeId'),
    date: g('date'),
    checkIn: orNull(g('checkIn')),
    lunchStart: orNull(g('lunchStart')),
    lunchEnd: orNull(g('lunchEnd')),
    checkOut: orNull(g('checkOut')),
  }

  let res: Response
  try {
    res = await fetch(`${API_URL}/attendance`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `auth=${authCookie}`,
        'X-Tenant': TENANT,
      },
      body: JSON.stringify(body),
    })
  } catch {
    return redirect('/attendance/new?error=server-error')
  }

  if (res.status === 401) return redirect('/login')
  if (res.ok) return redirect('/attendance?success=1')

  const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string }
  const msg = encodeURIComponent(data.error ?? data.message ?? 'server-error')
  return redirect(`/attendance/new?error=${msg}`)
}
