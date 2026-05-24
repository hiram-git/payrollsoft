import type { APIRoute } from 'astro'

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'

export const POST: APIRoute = async ({ request }) => {
  let body: { idNumber?: string; password?: string; tenant?: string }
  try {
    body = await request.json()
  } catch {
    return Response.json({ success: false, error: 'Solicitud inválida.' }, { status: 400 })
  }

  const idNumber = body.idNumber?.trim()
  const password = body.password
  const tenant = body.tenant?.trim().toLowerCase()

  if (!idNumber || !password || !tenant) {
    return Response.json({ success: false, error: 'Completa todos los campos.' }, { status: 400 })
  }

  let res: Response
  try {
    res = await fetch(`${API_URL}/portal/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant': tenant,
      },
      body: JSON.stringify({ idNumber, password }),
    })
  } catch (err) {
    console.error('[portal-login] fetch failed:', err)
    return Response.json(
      { success: false, error: 'Error de conexión. Intenta de nuevo.' },
      { status: 502 }
    )
  }

  const data = await res.json().catch(() => ({ success: false, error: 'Error del servidor.' }))

  const headers = new Headers({ 'Content-Type': 'application/json' })
  const setCookie = res.headers.get('set-cookie')
  if (setCookie) {
    headers.set('Set-Cookie', setCookie)
  }

  return new Response(JSON.stringify(data), { status: res.status, headers })
}
