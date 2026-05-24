import type { APIRoute } from 'astro'

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'

export const POST: APIRoute = async ({ request }) => {
  let body: { token?: string; password?: string; tenant?: string }
  try {
    body = await request.json()
  } catch {
    return Response.json({ success: false, error: 'Solicitud inválida.' }, { status: 400 })
  }

  const token = body.token?.trim()
  const password = body.password
  const tenant = body.tenant?.trim().toLowerCase()

  if (!token || !password || !tenant) {
    return Response.json({ success: false, error: 'Datos incompletos.' }, { status: 400 })
  }

  if (password.length < 6) {
    return Response.json(
      { success: false, error: 'La contraseña debe tener al menos 6 caracteres.' },
      { status: 400 }
    )
  }

  try {
    const res = await fetch(`${API_URL}/portal/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Tenant': tenant },
      body: JSON.stringify({ token, password }),
    })
    const data = await res.json()
    return Response.json(data, { status: res.status })
  } catch {
    return Response.json({ success: false, error: 'Error de conexión.' }, { status: 502 })
  }
}
