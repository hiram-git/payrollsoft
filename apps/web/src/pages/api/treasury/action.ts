/**
 * Proxy de acciones del módulo de tesorería.
 *
 *   POST /api/treasury/action?op=bank-create
 *   POST /api/treasury/action?op=bank-update&id=UUID
 *   POST /api/treasury/action?op=checkbook-create
 *   POST /api/treasury/action?op=run-create
 *   POST /api/treasury/action?op=run-close&id=UUID
 *   POST /api/treasury/action?op=check-issue&runId=UUID
 *   POST /api/treasury/action?op=check-void&id=UUID         body {reason}
 *   POST /api/treasury/action?op=ach-generate&runId=UUID
 *
 * Devuelve JSON `{ ok, error?, data?, redirect? }`. Si el caller envía
 * `X-SA-Modal: 1`, el cliente maneja el flujo (saModal); si no, el
 * proxy redirige con un flash en la querystring.
 */
import type { APIRoute } from 'astro'
import { getIdentity } from '../../../lib/auth'

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'

function flashUrl(base: string, flash: string, msg?: string): string {
  const u = new URL(base, 'http://placeholder')
  u.searchParams.set('flash', flash)
  if (msg) u.searchParams.set('msg', msg)
  return u.pathname + u.search
}

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
  const runId = (url.searchParams.get('runId') ?? '').trim()

  const ct = request.headers.get('content-type') ?? ''
  const isJsonClient = request.headers.get('x-sa-modal') === '1'
  const body: Record<string, unknown> = ct.includes('application/json')
    ? ((await request.json().catch(() => ({}))) as Record<string, unknown>)
    : Object.fromEntries(await request.formData())

  const redirectTo = String(body._redirect ?? '/treasury')

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
    return { ok: res.ok && json.success !== false, status: res.status, json }
  }

  const str = (v: unknown): string => (v == null ? '' : String(v))
  const strOrNull = (v: unknown): string | null => (v == null || v === '' ? null : String(v))
  const intOrUndef = (v: unknown): number | undefined => {
    if (v == null || v === '') return undefined
    const n = Number.parseInt(String(v), 10)
    return Number.isFinite(n) ? n : undefined
  }

  let result: { ok: boolean; status: number; json: { error?: string; data?: unknown } } = {
    ok: false,
    status: 500,
    json: {},
  }
  let flash = 'updated'

  switch (op) {
    case 'bank-create':
      flash = 'created'
      result = await call('/banks', 'POST', {
        code: str(body.code),
        name: str(body.name),
        routing: strOrNull(body.routing),
        swift: strOrNull(body.swift),
      })
      break
    case 'bank-update':
      result = await call(`/banks/${id}`, 'PUT', {
        name: body.name ? str(body.name) : undefined,
        routing: body.routing !== undefined ? strOrNull(body.routing) : undefined,
        swift: body.swift !== undefined ? strOrNull(body.swift) : undefined,
        isActive:
          body.isActive != null
            ? body.isActive === '1' || body.isActive === 1 || body.isActive === 'on'
              ? 1
              : 0
            : undefined,
        sortOrder: intOrUndef(body.sortOrder),
      })
      break
    case 'checkbook-create':
      flash = 'created'
      result = await call('/treasury/checkbooks', 'POST', {
        code: str(body.code),
        name: str(body.name),
        bankId: strOrNull(body.bankId),
        accountNumber: str(body.accountNumber),
        startNumber: intOrUndef(body.startNumber) ?? 1,
        endNumber: intOrUndef(body.endNumber) ?? 1,
        purpose: str(body.purpose) || 'general',
      })
      break
    case 'run-create':
      flash = 'created'
      result = await call('/treasury/runs', 'POST', {
        payrollId: strOrNull(body.payrollId),
        name: str(body.name),
        notes: strOrNull(body.notes),
      })
      break
    case 'run-close':
      result = await call(`/treasury/runs/${id}/close`, 'POST')
      break
    case 'check-issue':
      flash = 'created'
      result = await call(`/treasury/runs/${runId}/checks`, 'POST', {
        checkbookId: str(body.checkbookId),
        beneficiaryType: str(body.beneficiaryType) || 'employee',
        beneficiaryRefId: strOrNull(body.beneficiaryRefId),
        beneficiaryName: str(body.beneficiaryName),
        amount: str(body.amount),
        concept: strOrNull(body.concept),
        issueDate: str(body.issueDate),
      })
      break
    case 'check-void':
      result = await call(`/treasury/checks/${id}/void`, 'POST', {
        reason: str(body.reason),
      })
      break
    case 'ach-generate':
      flash = 'created'
      result = await call(`/treasury/runs/${runId}/ach`, 'POST', {
        payrollId: str(body.payrollId),
        sourceBankId: strOrNull(body.sourceBankId),
        frequency: str(body.frequency) || 'monthly',
        month: intOrUndef(body.month) ?? new Date().getMonth() + 1,
        year: intOrUndef(body.year) ?? new Date().getFullYear(),
        paymentDate: str(body.paymentDate),
      })
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
    return Response.redirect(new URL(flashUrl(redirectTo, 'error', String(msg)), request.url), 303)
  }

  if (isJsonClient) {
    return new Response(
      JSON.stringify({
        ok: true,
        redirect: flashUrl(redirectTo, flash),
        data: result.json.data ?? null,
      }),
      { headers: { 'Content-Type': 'application/json' } }
    )
  }
  return Response.redirect(new URL(flashUrl(redirectTo, flash), request.url), 303)
}
