import type { APIRoute } from 'astro'
import { getIdentity } from '../../../../lib/auth'

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'

const VALID_TYPES = new Set(['text', 'integer', 'float', 'date'])
const isModal = (req: Request) => req.headers.get('x-sa-modal') === '1'

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export const POST: APIRoute = async ({ request, cookies, redirect, params }) => {
  const identity = getIdentity(cookies)
  if (!identity) {
    if (isModal(request)) return jsonResponse(401, { ok: false, error: 'No autorizado.' })
    return redirect('/login')
  }
  const tenant = identity.tenantSlug ?? 'demo'
  const id = params.id
  if (!id) return redirect('/config/custom-fields')

  const form = await request.formData()
  const method = (form.get('_method') as string | null) ?? ''
  const headers = {
    'Content-Type': 'application/json',
    Cookie: `auth=${identity.raw}`,
    'X-Tenant': tenant,
  }

  const detailUrl = `/config/custom-fields/${id}`
  const fail = (status: number, detail: string) => {
    if (isModal(request)) return jsonResponse(status, { ok: false, error: detail })
    return redirect(`${detailUrl}?error=server-error&detail=${encodeURIComponent(detail)}`)
  }

  if (method === 'DELETE') {
    let res: Response
    try {
      res = await fetch(`${API_URL}/custom-fields/${id}`, { method: 'DELETE', headers })
    } catch (err) {
      return fail(502, err instanceof Error ? err.message : String(err))
    }
    if (res.status === 401) {
      if (isModal(request)) return jsonResponse(401, { ok: false, error: 'Sesión vencida.' })
      return redirect('/login')
    }
    if (!res.ok) {
      const body = await res.text().catch(() => `HTTP ${res.status}`)
      return fail(res.status, body)
    }
    if (isModal(request)) {
      return jsonResponse(200, {
        ok: true,
        redirect: '/config/custom-fields?flash=deleted',
        message: 'Campo desactivado.',
      })
    }
    return redirect('/config/custom-fields?flash=deleted')
  }

  // Default: UPDATE
  const name = ((form.get('name') as string | null) ?? '').trim()
  const description = ((form.get('description') as string | null) ?? '').trim() || null
  const fieldType = ((form.get('fieldType') as string | null) ?? 'text').trim()
  const isRequired = form.get('isRequired') === '1'
  const isActive = form.get('isActive') === '1'
  const sortOrderRaw = (form.get('sortOrder') as string | null) ?? ''
  const sortOrder = Number.isFinite(Number.parseInt(sortOrderRaw, 10))
    ? Number.parseInt(sortOrderRaw, 10)
    : 0
  const defaultValueRaw = ((form.get('defaultValue') as string | null) ?? '').trim()
  const defaultValue = defaultValueRaw.length > 0 ? defaultValueRaw : null

  const dependsOnJson = ((form.get('dependsOnJson') as string | null) ?? '').trim()
  let dependsOn: unknown[] = []
  if (dependsOnJson) {
    try {
      const parsed = JSON.parse(dependsOnJson)
      if (Array.isArray(parsed)) {
        dependsOn = parsed.filter((r) => {
          if (!r || typeof r !== 'object') return false
          const rec = r as Record<string, unknown>
          return typeof rec.field === 'string' && rec.field.length > 0 && rec.op && rec.effect
        })
      }
    } catch {
      return fail(400, 'Reglas de dependencia con formato inválido.')
    }
  }
  const readPermission = ((form.get('readPermission') as string | null) ?? '').trim() || null
  const writePermission = ((form.get('writePermission') as string | null) ?? '').trim() || null

  if (!name) return fail(400, 'El nombre es obligatorio.')
  if (!VALID_TYPES.has(fieldType)) return fail(400, `Tipo inválido: ${fieldType}`)

  let res: Response
  try {
    res = await fetch(`${API_URL}/custom-fields/${id}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        name,
        description,
        fieldType,
        isRequired,
        isActive,
        sortOrder,
        defaultValue,
        validationRules: { dependsOn, readPermission, writePermission },
      }),
    })
  } catch (err) {
    return fail(502, err instanceof Error ? err.message : String(err))
  }

  if (res.status === 401) {
    if (isModal(request)) return jsonResponse(401, { ok: false, error: 'Sesión vencida.' })
    return redirect('/login')
  }
  if (!res.ok) {
    const body = await res.text().catch(() => `HTTP ${res.status}`)
    return fail(res.status, body)
  }
  return redirect('/config/custom-fields?flash=updated')
}
