import type { APIRoute } from 'astro'
import { getIdentity } from '../../../lib/auth'

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'

/**
 * Form proxy for creating a custom role. Optionally seeds the initial
 * permission set in a follow-up call so the wizard finishes in one
 * round-trip from the user's perspective.
 *
 * Form fields:
 *   code         — snake_case identifier  (required)
 *   name         — human-readable name    (required)
 *   description  — optional free text
 *   permissions  — repeated checkbox values (any number, optional)
 */
export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const identity = getIdentity(cookies)
  if (!identity) return redirect('/login')

  const formData = await request.formData()
  const code = ((formData.get('code') as string | null) ?? '').trim().toLowerCase()
  const name = ((formData.get('name') as string | null) ?? '').trim()
  const description = ((formData.get('description') as string | null) ?? '').trim() || null
  const permissions = formData.getAll('permissions').map((p) => String(p))

  const errBack = (flag: string, detail?: string) => {
    const qs = new URLSearchParams({ error: flag })
    if (detail) qs.set('detail', detail.slice(0, 400))
    if (code) qs.set('code', code)
    if (name) qs.set('name', name)
    if (description) qs.set('description', description)
    return redirect(`/config/roles/new?${qs.toString()}`)
  }

  if (!code || !name) return errBack('missing-fields')
  if (!/^[a-z][a-z0-9_]*$/.test(code)) return errBack('invalid-code')
  if (code.length > 50) return errBack('invalid-code')

  const tenant = identity.tenantSlug ?? 'demo'

  let createRes: Response
  try {
    createRes = await fetch(`${API_URL}/roles`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `auth=${identity.raw}`,
        'X-Tenant': tenant,
      },
      body: JSON.stringify({ code, name, description }),
    })
  } catch (err) {
    console.error('[roles/create] fetch failed:', err)
    return errBack('server-error', err instanceof Error ? err.message : String(err))
  }

  if (createRes.status === 409) return errBack('code-taken')
  if (createRes.status === 401) return redirect('/login')
  if (createRes.status === 403) return errBack('forbidden')
  if (!createRes.ok) {
    const detail = await createRes.text().catch(() => '')
    return errBack('server-error', detail)
  }

  const json = (await createRes.json()) as { data: { id: string } }
  const roleId = json.data?.id
  if (!roleId) return errBack('server-error', 'API did not return role id')

  // Best-effort initial permission grant. Failing here still leaves a
  // valid (empty) role behind, so we redirect to its detail page with
  // a softer warning rather than aborting the whole flow.
  if (permissions.length > 0) {
    try {
      const permRes = await fetch(`${API_URL}/roles/${roleId}/permissions`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `auth=${identity.raw}`,
          'X-Tenant': tenant,
        },
        body: JSON.stringify({ permissions }),
      })
      if (!permRes.ok) {
        console.error('[roles/create] permission seed failed:', permRes.status)
        return redirect(`/config/roles/${roleId}?flash=created&error=perms-not-saved`)
      }
    } catch (err) {
      console.error('[roles/create] permission seed exception:', err)
      return redirect(`/config/roles/${roleId}?flash=created&error=perms-not-saved`)
    }
  }

  return redirect(`/config/roles/${roleId}?flash=created`)
}
