import type { APIRoute } from 'astro'
import { getIdentity } from '../../../../lib/auth'

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'

const VALID_TYPES = new Set(['text', 'integer', 'float', 'date'])

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const identity = getIdentity(cookies)
  if (!identity) return redirect('/login')
  const tenant = identity.tenantSlug ?? 'demo'

  const form = await request.formData()
  const code = ((form.get('code') as string | null) ?? '').trim().toLowerCase()
  const name = ((form.get('name') as string | null) ?? '').trim()
  const description = ((form.get('description') as string | null) ?? '').trim() || null
  const fieldType = ((form.get('fieldType') as string | null) ?? 'text').trim()
  const isRequired = form.get('isRequired') === '1'
  const sortOrderRaw = (form.get('sortOrder') as string | null) ?? ''
  const sortOrder = Number.isFinite(Number.parseInt(sortOrderRaw, 10))
    ? Number.parseInt(sortOrderRaw, 10)
    : 0
  const defaultValueRaw = ((form.get('defaultValue') as string | null) ?? '').trim()
  const defaultValue = defaultValueRaw.length > 0 ? defaultValueRaw : null

  const back = (flag: string, detail?: string) => {
    const qs = new URLSearchParams({ error: flag })
    if (detail) qs.set('detail', detail.slice(0, 400))
    if (code) qs.set('code', code)
    if (name) qs.set('name', name)
    if (fieldType) qs.set('fieldType', fieldType)
    return redirect(`/config/custom-fields/new?${qs.toString()}`)
  }

  if (!code || !name) return back('missing-fields')
  if (!/^[a-z][a-z0-9_]*$/.test(code) || code.length > 50) return back('invalid-code')
  if (!VALID_TYPES.has(fieldType)) return back('invalid-code', `Tipo inválido: ${fieldType}`)

  let res: Response
  try {
    res = await fetch(`${API_URL}/custom-fields`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `auth=${identity.raw}`,
        'X-Tenant': tenant,
      },
      body: JSON.stringify({
        code,
        name,
        description,
        fieldType,
        isRequired,
        sortOrder,
        defaultValue,
      }),
    })
  } catch (err) {
    return back('server-error', err instanceof Error ? err.message : String(err))
  }

  if (res.status === 401) return redirect('/login')
  if (res.status === 409) return back('code-taken')
  if (!res.ok) {
    const body = (await res.text().catch(() => '')) as string
    return back('server-error', body)
  }
  return redirect('/config/custom-fields?flash=created')
}
