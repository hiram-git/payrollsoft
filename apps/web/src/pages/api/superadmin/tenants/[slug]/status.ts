import type { APIRoute } from 'astro'
import { getIdentity } from '../../../../../lib/auth'

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'

const STATUS_MESSAGES: Record<string, string> = {
  ACTIVE: 'La empresa fue reactivada y vuelve a estar disponible.',
  SUSPENDED: 'La empresa fue suspendida. Sus usuarios no podrán iniciar sesión.',
  ARCHIVED: 'La empresa fue archivada.',
}

const isModal = (request: Request) => request.headers.get('x-sa-modal') === '1'

/** Form proxy for /superadmin/tenants/:slug status changes. */
export const POST: APIRoute = async ({ request, cookies, redirect, params }) => {
  const identity = getIdentity(cookies)
  if (!identity || identity.type !== 'super_admin') {
    if (isModal(request)) {
      return new Response(JSON.stringify({ ok: false, error: 'No autorizado.' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    return redirect('/superadmin/login')
  }

  const formData = await request.formData()
  const status = (formData.get('status') as string | null) ?? ''
  if (!['ACTIVE', 'SUSPENDED', 'ARCHIVED'].includes(status)) {
    if (isModal(request)) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Estado inválido.', detail: status }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }
    return redirect(`/superadmin/tenants/${params.slug}?error=server-error`)
  }

  let res: Response
  try {
    res = await fetch(`${API_URL}/superadmin/tenants/${params.slug}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `auth=${identity.raw}`,
      },
      body: JSON.stringify({ status }),
    })
  } catch (err) {
    console.error('[superadmin/tenants/:slug/status] fetch failed:', err)
    if (isModal(request)) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: 'No se pudo conectar con el servidor.',
          detail: err instanceof Error ? err.message : String(err),
        }),
        { status: 502, headers: { 'Content-Type': 'application/json' } }
      )
    }
    return redirect(`/superadmin/tenants/${params.slug}?error=server-error`)
  }

  if (!res.ok) {
    let detail: string | undefined
    try {
      detail = (await res.text()).slice(0, 500)
    } catch {
      // best effort
    }
    if (isModal(request)) {
      return new Response(
        JSON.stringify({ ok: false, error: 'No se pudo actualizar el estado.', detail }),
        { status: res.status, headers: { 'Content-Type': 'application/json' } }
      )
    }
    return redirect(`/superadmin/tenants/${params.slug}?error=server-error`)
  }

  if (isModal(request)) {
    return new Response(
      JSON.stringify({
        ok: true,
        redirect: `/superadmin/tenants/${params.slug}?flash=updated`,
        message: STATUS_MESSAGES[status],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }
  return redirect(`/superadmin/tenants/${params.slug}?flash=updated`)
}
