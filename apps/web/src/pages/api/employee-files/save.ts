/**
 * Proxy del formulario de alta/edición de expedientes. Acepta el
 * mismo `multipart/form-data` que la API espera y lo reenvía sin
 * transformaciones — los nombres de campo (`extra_*`, `file_*`,
 * `attachments`) se reciben tal cual.
 *
 * Modo:
 *   sin `id`  → POST /employee-files     (crear)
 *   con `id`  → PUT  /employee-files/:id (editar)
 *
 * Dual-mode: si la request trae `X-SA-Modal: 1` responde JSON; en
 * caso contrario hace redirect. Pensado para usarse con el flujo
 * `data-saconfirm` existente o con un fetch del cliente.
 */
import type { APIRoute } from 'astro'
import { getIdentity } from '../../../lib/auth'

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'

function isModal(req: Request) {
  return req.headers.get('x-sa-modal') === '1'
}

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
    return redirect('/employee-files?flash=error')
  }
  const id = (form.get('id') as string | null)?.trim() ?? ''
  form.delete('id')

  const url = id ? `${API_URL}/employee-files/${id}` : `${API_URL}/employee-files`
  const method = id ? 'PUT' : 'POST'

  let res: Response
  try {
    res = await fetch(url, {
      method,
      headers: {
        Cookie: `auth=${identity.raw}`,
        'X-Tenant': tenant,
      },
      body: form,
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
    const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string }
    const msg = body.error ?? body.message ?? `HTTP ${res.status}`
    if (isModal(request)) return jsonResponse(res.status, { ok: false, error: msg })
    return redirect(
      `/employee-files${id ? `/${id}/edit` : '/new'}?employeeId=${encodeURIComponent(
        (form.get('employeeId') as string | null) ?? ''
      )}&error=${encodeURIComponent(msg)}`
    )
  }

  const data = (await res.json().catch(() => ({}))) as {
    data?: { id?: string; documentNumber?: string }
  }
  const employeeId = (form.get('employeeId') as string | null) ?? ''
  const redirectUrl = `/employee-files?employeeId=${encodeURIComponent(employeeId)}&flash=${id ? 'updated' : 'created'}`
  if (isModal(request)) {
    return jsonResponse(200, {
      ok: true,
      redirect: redirectUrl,
      message: 'Expediente guardado.',
      data,
    })
  }
  return redirect(redirectUrl)
}
