import type { APIRoute } from 'astro'
import { getIdentity } from '../../../../../lib/auth'

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'

const isModal = (request: Request) => request.headers.get('x-sa-modal') === '1'

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * Form proxy that swaps the super-admin's JWT for a short-lived
 * tenant_admin JWT. The original super-admin token is stashed in the
 * `sa_session` cookie so /api/superadmin/end-impersonation can put it
 * back without forcing a re-login.
 */
export const POST: APIRoute = async ({ request, cookies, redirect, params }) => {
  const identity = getIdentity(cookies)
  if (!identity || identity.type !== 'super_admin') {
    if (isModal(request)) return json(401, { ok: false, error: 'No autorizado.' })
    return redirect('/superadmin/login')
  }

  let res: Response
  try {
    res = await fetch(`${API_URL}/superadmin/tenants/${params.slug}/impersonate`, {
      method: 'POST',
      headers: { Cookie: `auth=${identity.raw}` },
    })
  } catch (err) {
    console.error('[impersonate] fetch failed:', err)
    if (isModal(request)) {
      return json(502, {
        ok: false,
        error: 'No se pudo conectar con el servidor.',
        detail: err instanceof Error ? err.message : String(err),
      })
    }
    return redirect(`/superadmin/tenants/${params.slug}?error=server-error`)
  }

  if (!res.ok) {
    let detail = 'server-error'
    try {
      const body = (await res.json()) as { error?: string }
      if (body.error) detail = body.error
    } catch {
      // ignore
    }
    console.error(`[impersonate] API ${res.status}: ${detail}`)
    const flag =
      res.status === 404 ? 'no-admin' : res.status === 409 ? 'not-active' : 'server-error'

    if (isModal(request)) {
      const errorTitle =
        flag === 'no-admin'
          ? 'La empresa no tiene un administrador con is_tenant_admin = true.'
          : flag === 'not-active'
            ? 'Solo se puede impersonar a empresas en estado ACTIVE.'
            : 'No se pudo iniciar la impersonación.'
      return json(res.status, { ok: false, error: errorTitle, detail })
    }

    return redirect(
      `/superadmin/tenants/${params.slug}?error=${flag}&detail=${encodeURIComponent(detail)}`
    )
  }

  const apiJson = (await res.json()) as { data?: { token?: string; expiresInSeconds?: number } }
  const token = apiJson.data?.token
  const ttl = apiJson.data?.expiresInSeconds ?? 30 * 60
  if (!token) {
    if (isModal(request)) {
      return json(500, { ok: false, error: 'El servidor no devolvió un token de impersonación.' })
    }
    return redirect(`/superadmin/tenants/${params.slug}?error=server-error`)
  }

  // Save the original super-admin JWT so we can restore it on exit.
  cookies.set('sa_session', identity.raw, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: ttl,
  })

  // Replace the auth cookie with the tenant_admin token.
  cookies.set('auth', token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: ttl,
  })

  if (isModal(request)) {
    return json(200, {
      ok: true,
      redirect: '/config/users',
      message: 'Sesión de administrador iniciada por 30 minutos.',
    })
  }
  return redirect('/config/users')
}
