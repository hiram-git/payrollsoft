import type { APIRoute } from 'astro'
import { getIdentity } from '../../../../lib/auth'

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'

/**
 * Form proxy for the "Provisionar empresa" wizard. Maps the API's
 * structured error codes (slug_taken, invalid_slug, ...) onto query-string
 * flags the form page knows how to render.
 */
export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const identity = getIdentity(cookies)
  if (!identity || identity.type !== 'super_admin') return redirect('/superadmin/login')

  const formData = await request.formData()
  const slug = ((formData.get('slug') as string | null) ?? '').trim().toLowerCase()
  const name = ((formData.get('name') as string | null) ?? '').trim()
  const contactEmail = ((formData.get('contactEmail') as string | null) ?? '').trim() || undefined
  const adminName = ((formData.get('adminName') as string | null) ?? '').trim()
  const adminEmail = ((formData.get('adminEmail') as string | null) ?? '').trim().toLowerCase()
  const adminPassword = (formData.get('adminPassword') as string | null) ?? ''

  if (!slug || !name || !adminName || !adminEmail || !adminPassword) {
    return redirect('/superadmin/tenants/new?error=missing-fields')
  }
  if (adminPassword.length < 12) {
    return redirect('/superadmin/tenants/new?error=weak-password')
  }

  const qsBack = `slug=${encodeURIComponent(slug)}&name=${encodeURIComponent(name)}`

  let res: Response
  try {
    res = await fetch(`${API_URL}/superadmin/tenants`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `auth=${identity.raw}`,
      },
      body: JSON.stringify({
        slug,
        name,
        contactEmail,
        adminEmail,
        adminName,
        adminPassword,
      }),
    })
  } catch (err) {
    console.error('[superadmin/tenants/create] fetch failed:', err)
    return redirect(`/superadmin/tenants/new?error=server-error&${qsBack}`)
  }

  if (res.ok) {
    // Land on the tenant detail page so the user watches provisioning
    // transition from PROVISIONING → ACTIVE in real time. The detail
    // page polls itself while state=running.
    return redirect(`/superadmin/tenants/${slug}?flash=created`)
  }

  let kind: string | undefined
  try {
    const body = (await res.json()) as { error?: { kind?: string } | string }
    kind = typeof body.error === 'object' && body.error ? body.error.kind : undefined
  } catch {
    // ignore — we'll fall through to a generic error
  }

  const errorFlag =
    kind === 'slug_taken'
      ? 'slug-taken'
      : kind === 'invalid_slug'
        ? 'invalid-slug'
        : kind === 'admin_email_invalid'
          ? 'admin-email-invalid'
          : 'server-error'

  return redirect(`/superadmin/tenants/new?error=${errorFlag}&${qsBack}`)
}
