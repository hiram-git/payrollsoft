/**
 * Proxy de operaciones del catálogo global de permisos y roles del sistema.
 * Solo super-admin. Acepta JSON o form-data según el caller.
 *
 *   POST /api/superadmin/permissions?op=permission-create
 *   POST /api/superadmin/permissions?op=permission-update&code=XXX
 *   POST /api/superadmin/permissions?op=role-create
 *   POST /api/superadmin/permissions?op=role-update&code=XXX
 *   POST /api/superadmin/permissions?op=role-permissions&code=XXX
 *   POST /api/superadmin/permissions?op=role-propagate&code=XXX
 *
 * Devuelve JSON con `{ ok, redirect?, error?, result? }` para que el
 * cliente decida si redirigir, mostrar modal de éxito, etc.
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
  if (!identity || identity.type !== 'super_admin') {
    return new Response(JSON.stringify({ ok: false, error: 'No autorizado' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const url = new URL(request.url)
  const op = (url.searchParams.get('op') ?? '').trim()
  const code = (url.searchParams.get('code') ?? '').trim()
  const ct = request.headers.get('content-type') ?? ''
  const isJsonClient = request.headers.get('x-sa-modal') === '1'

  // Para form-data preservamos los multivalor (e.g. `permissions` aparece
  // múltiples veces cuando se marca un checkbox por permiso) y los
  // colapsamos a array. Object.fromEntries() solo guarda el último valor.
  let body: Record<string, unknown>
  let multiPermissions: string[] = []
  if (ct.includes('application/json')) {
    body = (await request.json().catch(() => ({}))) as Record<string, unknown>
  } else {
    const fd = await request.formData()
    multiPermissions = fd.getAll('permissions').map((v) => String(v))
    body = Object.fromEntries(fd)
  }

  const redirectTo = String(body._redirect ?? '/superadmin/permissions')

  const callApi = async (path: string, method: string, payload?: unknown) => {
    const res = await fetch(`${API_URL}${path}`, {
      method,
      headers: {
        Cookie: `auth=${identity.raw}`,
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
    return { ok: res.ok, status: res.status, json }
  }

  const bool = (v: unknown): boolean => v === '1' || v === 1 || v === 'on' || v === true
  const strOrUndef = (v: unknown): string | undefined =>
    v == null || v === '' ? undefined : String(v)

  let result: { ok: boolean; status: number; json: { error?: string; data?: unknown } } = {
    ok: false,
    status: 500,
    json: {},
  }
  let flash = 'updated'

  switch (op) {
    case 'permission-create': {
      flash = 'created'
      const cd = String(body.code ?? '')
      const parsed = cd.split(':')
      const mod = strOrUndef(body.module) ?? parsed[0] ?? ''
      const act = strOrUndef(body.action) ?? parsed[1]?.split('.')[0] ?? ''
      result = await callApi('/superadmin/permissions', 'POST', {
        code: cd,
        module: mod,
        action: act,
        scope: body.scope === 'global' ? 'global' : 'tenant',
        description: String(body.description ?? ''),
        isDangerous: bool(body.isDangerous),
      })
      break
    }
    case 'permission-update': {
      result = await callApi(`/superadmin/permissions/${encodeURIComponent(code)}`, 'PUT', {
        description: strOrUndef(body.description),
        scope: body.scope === 'global' || body.scope === 'tenant' ? body.scope : undefined,
        isDangerous: body.isDangerous != null ? bool(body.isDangerous) : undefined,
      })
      break
    }
    case 'role-create': {
      flash = 'created'
      result = await callApi('/superadmin/system-roles', 'POST', {
        code: String(body.code ?? ''),
        name: String(body.name ?? ''),
        description: strOrUndef(body.description) ?? null,
        isDangerous: bool(body.isDangerous),
      })
      break
    }
    case 'role-update': {
      result = await callApi(`/superadmin/system-roles/${encodeURIComponent(code)}`, 'PUT', {
        name: strOrUndef(body.name),
        description: strOrUndef(body.description) ?? null,
        isDangerous: body.isDangerous != null ? bool(body.isDangerous) : undefined,
      })
      break
    }
    case 'role-permissions': {
      // JSON: viene como array. Form-data: recolectado vía getAll() arriba.
      const perms = Array.isArray(body.permissions)
        ? body.permissions.map(String)
        : multiPermissions
      result = await callApi(
        `/superadmin/system-roles/${encodeURIComponent(code)}/permissions`,
        'PUT',
        { permissions: perms }
      )
      break
    }
    case 'role-propagate': {
      flash = 'propagated'
      result = await callApi(
        `/superadmin/system-roles/${encodeURIComponent(code)}/propagate`,
        'POST'
      )
      break
    }
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
        result: result.json.data ?? null,
      }),
      { headers: { 'Content-Type': 'application/json' } }
    )
  }
  return Response.redirect(new URL(flashUrl(redirectTo, flash), request.url), 303)
}
