import type { APIRoute } from 'astro'

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'

export const POST: APIRoute = async ({ request }) => {
  let body: { idNumber?: string; tenant?: string }
  try {
    body = await request.json()
  } catch {
    return Response.json({ success: false, error: 'Solicitud inválida.' }, { status: 400 })
  }

  const idNumber = body.idNumber?.trim()
  const tenant = body.tenant?.trim().toLowerCase()

  if (!idNumber || !tenant) {
    return Response.json({ success: false, error: 'Completa todos los campos.' }, { status: 400 })
  }

  try {
    const res = await fetch(`${API_URL}/portal/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Tenant': tenant },
      body: JSON.stringify({ idNumber }),
    })
    const data = await res.json()
    return Response.json(data, { status: res.status })
  } catch {
    return Response.json({ success: false, error: 'Error de conexión.' }, { status: 502 })
  }
}
