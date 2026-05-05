import type { APIRoute } from 'astro'
import { getIdentity } from '../../../../lib/auth'

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'

const ERROR_LABELS: Record<string, string> = {
  'missing-fields': 'Completa todos los campos obligatorios.',
  'weak-password': 'La contraseña debe tener al menos 12 caracteres.',
  'invalid-slug':
    'El identificador no es válido. Usa solo letras minúsculas, números, guion y guion bajo (3 a 50 caracteres).',
  'slug-taken': 'Ese identificador ya está en uso por otra empresa.',
  'admin-email-invalid': 'El correo del administrador no es válido.',
  'server-error': 'No se pudo crear la empresa.',
}

function isModal(request: Request) {
  return request.headers.get('x-sa-modal') === '1'
}

function jsonOk(data: { redirect: string; message?: string }) {
  return new Response(JSON.stringify({ ok: true, ...data }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

function jsonErr(error: string, opts?: { status?: number; detail?: string }) {
  return new Response(JSON.stringify({ ok: false, error, detail: opts?.detail }), {
    status: opts?.status ?? 400,
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * Form proxy for the "Provisionar empresa" wizard. Returns JSON when the
 * caller is the SuperAdmin modal helper (X-SA-Modal: 1) and falls back
 * to redirects for traditional form submissions.
 */
export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const identity = getIdentity(cookies)
  if (!identity || identity.type !== 'super_admin') {
    if (isModal(request)) return jsonErr('No autorizado.', { status: 401 })
    return redirect('/superadmin/login')
  }

  const formData = await request.formData()
  const slug = ((formData.get('slug') as string | null) ?? '').trim().toLowerCase()
  const name = ((formData.get('name') as string | null) ?? '').trim()
  const contactEmail = ((formData.get('contactEmail') as string | null) ?? '').trim() || undefined
  const adminName = ((formData.get('adminName') as string | null) ?? '').trim()
  const adminEmail = ((formData.get('adminEmail') as string | null) ?? '').trim().toLowerCase()
  const adminPassword = (formData.get('adminPassword') as string | null) ?? ''

  const qsBack = `slug=${encodeURIComponent(slug)}&name=${encodeURIComponent(name)}`

  if (!slug || !name || !adminName || !adminEmail || !adminPassword) {
    if (isModal(request)) return jsonErr(ERROR_LABELS['missing-fields'])
    return redirect('/superadmin/tenants/new?error=missing-fields')
  }
  if (adminPassword.length < 12) {
    if (isModal(request)) return jsonErr(ERROR_LABELS['weak-password'])
    return redirect('/superadmin/tenants/new?error=weak-password')
  }

  let res: Response
  try {
    res = await fetch(`${API_URL}/superadmin/tenants`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `auth=${identity.raw}`,
      },
      body: JSON.stringify({ slug, name, contactEmail, adminEmail, adminName, adminPassword }),
    })
  } catch (err) {
    console.error('[superadmin/tenants/create] fetch failed:', err)
    if (isModal(request)) {
      return jsonErr(ERROR_LABELS['server-error'], {
        status: 502,
        detail: err instanceof Error ? err.message : String(err),
      })
    }
    return redirect(`/superadmin/tenants/new?error=server-error&${qsBack}`)
  }

  if (res.ok) {
    if (isModal(request)) {
      return jsonOk({
        redirect: `/superadmin/tenants/${slug}?flash=created`,
        message: `La empresa "${name}" fue creada correctamente.`,
      })
    }
    return redirect(`/superadmin/tenants/${slug}?flash=created`)
  }

  let kind: string | undefined
  let detail: string | undefined
  try {
    const body = (await res.json()) as {
      error?: { kind?: string; message?: string } | string
    }
    if (typeof body.error === 'object' && body.error) {
      kind = body.error.kind
      detail = body.error.message
    }
  } catch {
    // ignore
  }
  if (!detail) {
    try {
      detail = (await res.clone().text()).slice(0, 500)
    } catch {
      // best effort
    }
  }

  const errorFlag =
    kind === 'slug_taken'
      ? 'slug-taken'
      : kind === 'invalid_slug'
        ? 'invalid-slug'
        : kind === 'admin_email_invalid'
          ? 'admin-email-invalid'
          : 'server-error'

  console.error('[superadmin/tenants/create] api error', { status: res.status, kind, detail })

  if (isModal(request)) {
    return jsonErr(ERROR_LABELS[errorFlag] ?? ERROR_LABELS['server-error'], {
      status: res.status,
      detail,
    })
  }

  const detailQs = detail ? `&detail=${encodeURIComponent(detail)}` : ''
  return redirect(`/superadmin/tenants/new?error=${errorFlag}&${qsBack}${detailQs}`)
}
