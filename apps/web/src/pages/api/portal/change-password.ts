import type { APIRoute } from 'astro'

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'

export const POST: APIRoute = async ({ request, cookies }) => {
  const portalCookie = cookies.get('portal_auth')?.value
  if (!portalCookie) {
    return Response.json({ success: false, error: 'No autenticado.' }, { status: 401 })
  }

  let body: { password?: string }
  try {
    body = await request.json()
  } catch {
    return Response.json({ success: false, error: 'Solicitud inválida.' }, { status: 400 })
  }

  if (!body.password || body.password.length < 6) {
    return Response.json(
      { success: false, error: 'La contraseña debe tener al menos 6 caracteres.' },
      { status: 400 }
    )
  }

  try {
    const res = await fetch(`${API_URL}/portal/auth/change-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `portal_auth=${portalCookie}`,
      },
      body: JSON.stringify({ password: body.password }),
    })

    const data = await res.json().catch(() => ({ success: false, error: 'Error del servidor.' }))

    const headers = new Headers({ 'Content-Type': 'application/json' })
    const setCookie = res.headers.get('set-cookie')
    if (setCookie) headers.set('Set-Cookie', setCookie)

    return new Response(JSON.stringify(data), { status: res.status, headers })
  } catch {
    return Response.json({ success: false, error: 'Error de conexión.' }, { status: 502 })
  }
}
