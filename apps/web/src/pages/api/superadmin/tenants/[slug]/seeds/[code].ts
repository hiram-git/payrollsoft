import type { APIRoute } from 'astro'
import { getIdentity } from '../../../../../../lib/auth'

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'

const isModal = (request: Request) => request.headers.get('x-sa-modal') === '1'

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const VALID_CODES = new Set(['employees', 'loans'])

/**
 * Proxy del endpoint POST /superadmin/tenants/:slug/seeds/:code.
 * Recibe form-data del modal-form en la página de detalle, valida los
 * parámetros y reenvía como JSON al API. Dual-mode: responde JSON al
 * modal helper o redirige a la detalle del tenant en submit clásico.
 */
export const POST: APIRoute = async ({ request, cookies, redirect, params }) => {
  const identity = getIdentity(cookies)
  if (!identity || identity.type !== 'super_admin') {
    if (isModal(request)) return json(401, { ok: false, error: 'No autorizado.' })
    return redirect('/superadmin/login')
  }

  const slug = params.slug
  const code = params.code
  if (!slug || !code || !VALID_CODES.has(code)) {
    if (isModal(request)) return json(400, { ok: false, error: 'Seed inválido.' })
    return redirect(`/superadmin/tenants/${slug ?? ''}?error=server-error`)
  }

  let employeesTotal: number | undefined
  try {
    const form = await request.formData()
    const raw = form.get('employeesTotal')
    if (typeof raw === 'string' && raw.trim().length > 0) {
      const n = Number.parseInt(raw, 10)
      if (Number.isInteger(n) && n >= 1 && n <= 10000) employeesTotal = n
    }
  } catch {
    // best-effort
  }

  let res: Response
  try {
    res = await fetch(`${API_URL}/superadmin/tenants/${slug}/seeds/${code}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `auth=${identity.raw}`,
      },
      body: JSON.stringify({ employeesTotal }),
    })
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    if (isModal(request)) {
      return json(502, {
        ok: false,
        error: 'No se pudo conectar con el servidor.',
        detail,
      })
    }
    return redirect(`/superadmin/tenants/${slug}?error=server-error`)
  }

  if (!res.ok) {
    let upstreamError = `HTTP ${res.status}`
    let upstreamMessage: string | undefined
    try {
      const body = (await res.json()) as { error?: string; message?: string }
      upstreamError = body.error ?? upstreamError
      upstreamMessage = body.message
    } catch {
      // best-effort
    }
    const niceTitle =
      upstreamError === 'already_applied'
        ? `El seed "${code}" ya fue aplicado a esta empresa.`
        : `No se pudo aplicar el seed "${code}".`
    if (isModal(request)) {
      return json(res.status, {
        ok: false,
        error: niceTitle,
        detail: upstreamMessage ?? upstreamError,
      })
    }
    return redirect(`/superadmin/tenants/${slug}?error=server-error`)
  }

  const apiJson = (await res.json().catch(() => null)) as {
    data?: { kind?: string; result?: Record<string, unknown> }
  } | null
  const stats = apiJson?.data?.result
  const summary = stats
    ? Object.entries(stats)
        .map(([k, v]) => `${k}: ${v}`)
        .join(' · ')
    : 'Seed aplicado correctamente.'

  if (isModal(request)) {
    return json(200, {
      ok: true,
      redirect: `/superadmin/tenants/${slug}`,
      message: summary,
    })
  }
  return redirect(`/superadmin/tenants/${slug}?flash=updated`)
}
