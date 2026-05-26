/**
 * Proxy de acciones para el módulo de vacaciones.
 *
 *   POST /api/vacations/action?op=create
 *   POST /api/vacations/action?op=cancel&id=UUID
 *   POST /api/vacations/action?op=approve&id=UUID
 *   POST /api/vacations/action?op=reject&id=UUID         body {reason}
 *   POST /api/vacations/action?op=adjust                 body {employeeId,pool,days,notes}
 *   POST /api/vacations/action?op=rule-create            body
 *   POST /api/vacations/action?op=rule-delete&id=UUID
 *
 * Devuelve JSON con {ok, error?, data?, redirect?}. Si el caller
 * envía `X-SA-Modal: 1`, no redirige (deja que el cliente maneje).
 */
import type { APIRoute } from 'astro'
import { getIdentity } from '../../../lib/auth'

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'

export const POST: APIRoute = async ({ request, cookies }) => {
  const identity = getIdentity(cookies)
  if (!identity) {
    return new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  const tenant = identity.tenantSlug ?? 'demo'
  const url = new URL(request.url)
  const op = (url.searchParams.get('op') ?? '').trim()
  const id = (url.searchParams.get('id') ?? '').trim()

  const ct = request.headers.get('content-type') ?? ''
  const body: Record<string, unknown> = ct.includes('application/json')
    ? ((await request.json().catch(() => ({}))) as Record<string, unknown>)
    : Object.fromEntries(await request.formData())

  const call = async (path: string, method: string, payload?: unknown) => {
    const res = await fetch(`${API_URL}${path}`, {
      method,
      headers: {
        Cookie: `auth=${identity.raw}`,
        'X-Tenant': tenant,
        'Content-Type': 'application/json',
      },
      body: payload == null ? undefined : JSON.stringify(payload),
    })
    const text = await res.text()
    let json: { success?: boolean; error?: string; data?: unknown } = {}
    try {
      json = text ? JSON.parse(text) : {}
    } catch {
      /* texto plano */
    }
    return { status: res.status, ok: res.ok && json.success !== false, json }
  }

  const intOrZero = (v: unknown): number => {
    if (v == null || v === '') return 0
    const n = Number.parseInt(String(v), 10)
    return Number.isFinite(n) ? n : 0
  }
  const strOrNull = (v: unknown): string | null => (v == null || v === '' ? null : String(v))

  let result: { status: number; ok: boolean; json: { error?: string; data?: unknown } } = {
    status: 500,
    ok: false,
    json: {},
  }

  switch (op) {
    case 'create':
      result = await call('/vacations', 'POST', {
        employeeId: String(body.employeeId ?? ''),
        requestType: String(body.requestType ?? ''),
        startDate: strOrNull(body.startDate),
        endDate: strOrNull(body.endDate),
        enjoyDays: intOrZero(body.enjoyDays),
        paidDays: intOrZero(body.paidDays),
        reason: strOrNull(body.reason),
      })
      break
    case 'cancel':
      result = await call(`/vacations/${id}/cancel`, 'POST')
      break
    case 'approve':
      result = await call(`/vacations/${id}/approve`, 'POST')
      break
    case 'reject':
      result = await call(`/vacations/${id}/reject`, 'POST', {
        reason: String(body.reason ?? ''),
      })
      break
    case 'adjust':
      result = await call('/vacations/adjust', 'POST', {
        employeeId: String(body.employeeId ?? ''),
        pool: String(body.pool ?? ''),
        days: intOrZero(body.days),
        notes: String(body.notes ?? ''),
      })
      break
    case 'rule-create':
      result = await call('/vacations/approval-rules', 'POST', {
        requestType: strOrNull(body.requestType),
        departmentId: strOrNull(body.departmentId),
        approverRole: String(body.approverRole ?? ''),
      })
      break
    case 'rule-delete':
      result = await call(`/vacations/approval-rules/${id}`, 'DELETE')
      break
    default:
      return new Response(JSON.stringify({ ok: false, error: 'Operación inválida' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
  }

  return new Response(
    JSON.stringify({
      ok: result.ok,
      error: result.ok ? null : (result.json.error ?? `HTTP ${result.status}`),
      data: result.json.data ?? null,
    }),
    { status: result.status, headers: { 'Content-Type': 'application/json' } }
  )
}
