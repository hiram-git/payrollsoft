/**
 * Proxy DELETE para expedientes. Acepta `id` por form-data; redirige
 * a `/employee-files?employeeId=…` con flash al terminar (o devuelve
 * JSON si la request viene del helper saModal).
 */
import type { APIRoute } from 'astro'
import { getIdentity } from '../../../lib/auth'

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'

const isModal = (req: Request) => req.headers.get('x-sa-modal') === '1'

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const identity = getIdentity(cookies)
  if (!identity) {
    if (isModal(request)) return jsonResponse(401, { ok: false, error: 'No autorizado.' })
    return redirect('/login')
  }
  const tenant = identity.tenantSlug ?? 'demo'

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    if (isModal(request)) return jsonResponse(400, { ok: false, error: 'Form inválido.' })
    return redirect('/employee-files')
  }
  const id = (form.get('id') as string | null)?.trim() ?? ''
  const employeeId = (form.get('employeeId') as string | null)?.trim() ?? ''
  if (!id) {
    if (isModal(request)) return jsonResponse(400, { ok: false, error: 'Falta `id`.' })
    return redirect('/employee-files')
  }

  let res: Response
  try {
    res = await fetch(`${API_URL}/employee-files/${id}`, {
      method: 'DELETE',
      headers: { Cookie: `auth=${identity.raw}`, 'X-Tenant': tenant },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (isModal(request)) return jsonResponse(502, { ok: false, error: msg })
    return redirect('/employee-files?flash=error')
  }
  if (res.status === 401) {
    if (isModal(request)) return jsonResponse(401, { ok: false, error: 'Sesión vencida.' })
    return redirect('/login')
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    const msg = body.error ?? `HTTP ${res.status}`
    if (isModal(request)) return jsonResponse(res.status, { ok: false, error: msg })
    return redirect('/employee-files?flash=error')
  }

  const redirectUrl = employeeId
    ? `/employee-files?employeeId=${encodeURIComponent(employeeId)}&flash=deleted`
    : '/employee-files?flash=deleted'
  if (isModal(request)) {
    return jsonResponse(200, { ok: true, redirect: redirectUrl, message: 'Expediente eliminado.' })
  }
  return redirect(redirectUrl)
}
