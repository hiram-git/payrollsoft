/**
 * Proxy de escritura para las operaciones de configuración del módulo
 * de expedientes (`/employee-files/admin/types*`, `/admin/subtypes*`,
 * `/approval-rules*`).
 *
 *   POST   /api/employee-files/admin?op=type-create
 *   POST   /api/employee-files/admin?op=type-update&id=N
 *   POST   /api/employee-files/admin?op=subtype-create
 *   POST   /api/employee-files/admin?op=subtype-update&id=N
 *   POST   /api/employee-files/admin?op=rule-create
 *   POST   /api/employee-files/admin?op=rule-delete&id=UUID
 *
 * Acepta `application/x-www-form-urlencoded` desde forms HTML clásicos
 * (con `data-saconfirm` o `<form method="POST">`) y devuelve JSON o
 * un 303 redirect según `Accept` o el hint `X-SA-Modal`.
 */
import type { APIRoute } from 'astro'
import { getIdentity } from '../../../lib/auth'

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'

function flashUrl(base: string, flash: string, error?: string): string {
  const u = new URL(base, 'http://placeholder')
  u.searchParams.set('flash', flash)
  if (error) u.searchParams.set('error', error)
  return u.pathname + u.search
}

export const POST: APIRoute = async ({ request, cookies }) => {
  const identity = getIdentity(cookies)
  if (!identity) return new Response('Unauthorized', { status: 401 })
  const tenant = identity.tenantSlug ?? 'demo'

  const url = new URL(request.url)
  const op = (url.searchParams.get('op') ?? '').trim()
  const id = (url.searchParams.get('id') ?? '').trim()

  const ct = request.headers.get('content-type') ?? ''
  const form = ct.includes('application/json')
    ? await request.json().catch(() => ({}))
    : Object.fromEntries(await request.formData())
  const isJsonClient = request.headers.get('x-sa-modal') === '1'
  const redirectTo = String(form._redirect ?? '/config/employee-files')

  const callApi = async (path: string, method: string, body?: unknown) => {
    const res = await fetch(`${API_URL}${path}`, {
      method,
      headers: {
        Cookie: `auth=${identity.raw}`,
        'X-Tenant': tenant,
        'Content-Type': 'application/json',
      },
      body: body == null ? undefined : JSON.stringify(body),
    })
    const text = await res.text()
    let json: { success?: boolean; error?: string; data?: unknown } = {}
    try {
      json = text ? JSON.parse(text) : {}
    } catch {
      /* texto plano */
    }
    return { ok: res.ok, status: res.status, json }
  }

  const intOrUndef = (v: unknown): number | undefined => {
    if (v == null || v === '') return undefined
    const n = Number.parseInt(String(v), 10)
    return Number.isFinite(n) ? n : undefined
  }

  const flag = (v: unknown): number => (v === '1' || v === 1 || v === 'on' || v === true ? 1 : 0)

  let result: { ok: boolean; status: number; json: { error?: string } } = {
    ok: false,
    status: 500,
    json: {},
  }
  let flash = 'updated'

  switch (op) {
    case 'type-create':
      flash = 'created'
      result = await callApi('/employee-files/admin/types', 'POST', {
        code: String(form.code ?? ''),
        name: String(form.name ?? ''),
        description: form.description ? String(form.description) : null,
        sortOrder: intOrUndef(form.sortOrder),
        requiresApproval: flag(form.requiresApproval),
      })
      break
    case 'type-update':
      result = await callApi(`/employee-files/admin/types/${id}`, 'PUT', {
        name: form.name ? String(form.name) : undefined,
        description: form.description != null ? String(form.description) : undefined,
        sortOrder: intOrUndef(form.sortOrder),
        requiresApproval: flag(form.requiresApproval),
        isActive: form.isActive != null ? flag(form.isActive) : undefined,
      })
      break
    case 'subtype-create':
      flash = 'created'
      result = await callApi('/employee-files/admin/subtypes', 'POST', {
        typeId: intOrUndef(form.typeId),
        code: String(form.code ?? ''),
        name: String(form.name ?? ''),
        sortOrder: intOrUndef(form.sortOrder),
        requiresApproval: flag(form.requiresApproval),
      })
      break
    case 'subtype-update':
      result = await callApi(`/employee-files/admin/subtypes/${id}`, 'PUT', {
        name: form.name ? String(form.name) : undefined,
        sortOrder: intOrUndef(form.sortOrder),
        requiresApproval: flag(form.requiresApproval),
        isActive: form.isActive != null ? flag(form.isActive) : undefined,
      })
      break
    case 'rule-create':
      flash = 'created'
      result = await callApi('/employee-files/approval-rules', 'POST', {
        typeId: intOrUndef(form.typeId),
        subtypeId: form.subtypeId ? intOrUndef(form.subtypeId) : null,
        approverRole: String(form.approverRole ?? ''),
      })
      break
    case 'rule-delete':
      flash = 'deleted'
      result = await callApi(`/employee-files/approval-rules/${id}`, 'DELETE')
      break
    default:
      return new Response(JSON.stringify({ ok: false, error: 'Operación inválida' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
  }

  if (!result.ok) {
    const msg = result.json.error ?? `HTTP ${result.status}`
    if (isJsonClient) {
      return new Response(JSON.stringify({ ok: false, error: msg }), {
        status: result.status,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    return Response.redirect(new URL(flashUrl(redirectTo, 'error', msg), request.url), 303)
  }

  if (isJsonClient) {
    return new Response(JSON.stringify({ ok: true, redirect: flashUrl(redirectTo, flash) }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }
  return Response.redirect(new URL(flashUrl(redirectTo, flash), request.url), 303)
}
