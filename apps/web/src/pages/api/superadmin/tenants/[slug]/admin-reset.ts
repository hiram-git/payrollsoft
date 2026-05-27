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

/** Form proxy for resetting the tenant admin password. */
export const POST: APIRoute = async ({ request, cookies, redirect, params }) => {
  const identity = getIdentity(cookies)
  if (!identity || identity.type !== 'super_admin') {
    if (isModal(request)) return json(401, { ok: false, error: 'No autorizado.' })
    return redirect('/superadmin/login')
  }

  const formData = await request.formData()
  const password = (formData.get('password') as string | null) ?? ''
  if (password.length < 12) {
    if (isModal(request)) {
      return json(400, {
        ok: false,
        error: 'La contraseña debe tener al menos 12 caracteres.',
      })
    }
    return redirect(`/superadmin/tenants/${params.slug}?error=server-error`)
  }

  let res: Response
  try {
    res = await fetch(`${API_URL}/superadmin/tenants/${params.slug}/admin/reset`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `auth=${identity.raw}`,
      },
      body: JSON.stringify({ password }),
    })
  } catch (err) {
    console.error('[superadmin/admin-reset] fetch failed:', err)
    if (isModal(request)) {
      return json(502, {
        ok: false,
        error: 'No se pudo conectar con el servidor.',
        detail: err instanceof Error ? err.message : String(err),
      })
    }
    return redirect(`/superadmin/tenants/${params.slug}?error=server-error`)
  }

  if (res.status === 404) {
    if (isModal(request)) {
      return json(404, {
        ok: false,
        error: 'La empresa no tiene un administrador asignado.',
      })
    }
    return redirect(`/superadmin/tenants/${params.slug}?error=no-admin`)
  }

  if (!res.ok) {
    let detail: string | undefined
    try {
      detail = (await res.text()).slice(0, 500)
    } catch {
      // best effort
    }
    if (isModal(request)) {
      return json(res.status, {
        ok: false,
        error: 'No se pudo restablecer la contraseña.',
        detail,
      })
    }
    return redirect(`/superadmin/tenants/${params.slug}?error=server-error`)
  }

  if (isModal(request)) {
    return json(200, {
      ok: true,
      redirect: `/superadmin/tenants/${params.slug}?flash=admin-reset`,
      message: 'La contraseña del administrador fue actualizada.',
    })
  }
  return redirect(`/superadmin/tenants/${params.slug}?flash=admin-reset`)
}
