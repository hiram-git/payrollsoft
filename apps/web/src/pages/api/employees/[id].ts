import type { APIRoute } from 'astro'
import { resolveTenantSlugFromCookie } from '../../../lib/tenant-slug'

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'

export const POST: APIRoute = async ({ request, cookies, params, redirect }) => {
  const authCookie = cookies.get('auth')?.value
  if (!authCookie) return redirect('/login')
  const TENANT = resolveTenantSlugFromCookie(authCookie)

  const { id } = params
  const form = await request.formData()
  const method = form.get('_method')?.toString() ?? 'PUT'

  // ── DELETE (deactivate) ───────────────────────────────────────────────────────
  if (method === 'DELETE') {
    try {
      const res = await fetch(`${API_URL}/employees/${id}`, {
        method: 'DELETE',
        headers: { Cookie: `auth=${authCookie}`, 'X-Tenant': TENANT },
      })
      if (res.status === 401) return redirect('/login')
    } catch {
      return redirect(`/employees/${id}?error=server-error`)
    }
    return redirect('/employees')
  }

  // ── PUT (update) ──────────────────────────────────────────────────────────────
  const g = (k: string) => form.get(k)?.toString().trim() ?? ''
  const has = (k: string) => form.get(k) === 'on' || form.get(k) === 'true'
  const payrollTypeIds = form.getAll('payrollTypeIds[]').map(String).filter(Boolean)

  // AJAX submit (X-Form-Submit) gets JSON {ok, error?, redirect?} so the form
  // keeps its state on error; classic POST keeps redirecting for no-JS.
  const isAjax = request.headers.get('X-Form-Submit') === '1'
  const fail = (code: string, status = 400) =>
    isAjax
      ? new Response(JSON.stringify({ ok: false, error: code }), {
          status,
          headers: { 'Content-Type': 'application/json' },
        })
      : redirect(`/employees/${id}?error=${code}`)
  const ok = (to: string) =>
    isAjax
      ? new Response(JSON.stringify({ ok: true, redirect: to }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      : redirect(to)

  // Recoger campos adicionales del form (prefijo cf_<code>) y serializar
  // según su tipo. El proxy consulta el catálogo activo para saber qué
  // tipo cast aplicar, evitando sorpresas en el motor de fórmulas.
  type CustomFieldDef = {
    code: string
    fieldType: 'text' | 'integer' | 'float' | 'date'
    isActive: boolean
  }
  let customFields: Record<string, unknown> | undefined
  try {
    const defsRes = await fetch(`${API_URL}/custom-fields`, {
      headers: { Cookie: `auth=${authCookie}`, 'X-Tenant': TENANT },
    })
    if (defsRes.ok) {
      const defs = ((await defsRes.json()) as { data: CustomFieldDef[] }).data ?? []
      const collected: Record<string, unknown> = {}
      let touched = false
      for (const def of defs) {
        if (!def.isActive) continue
        const key = `cf_${def.code}`
        if (!form.has(key)) continue
        touched = true
        const raw = (form.get(key) as string | null)?.trim() ?? ''
        if (raw === '') {
          collected[def.code] = null
          continue
        }
        if (def.fieldType === 'integer') {
          const n = Number.parseInt(raw, 10)
          collected[def.code] = Number.isFinite(n) ? n : null
        } else if (def.fieldType === 'float') {
          const n = Number(raw)
          collected[def.code] = Number.isFinite(n) ? n : null
        } else {
          // text + date: stored as string
          collected[def.code] = raw
        }
      }
      if (touched) customFields = collected
    }
  } catch {
    // best-effort: si el catálogo no responde, no sobreescribimos custom_fields
  }

  // Reenvía un campo opcional solo si el form realmente lo trajo, para que un
  // submit parcial no borre lo que no rendea. String vacío → null (limpia).
  const opt = (k: string): Record<string, unknown> =>
    form.has(k) ? { [k]: g(k) || null } : {}

  const body: Record<string, unknown> = {
    // Requeridos
    code: g('code'),
    firstName: g('firstName'),
    lastName: g('lastName'),
    idNumber: g('idNumber'),
    hireDate: g('hireDate'),
    baseSalary: g('baseSalary'),
    payFrequency: g('payFrequency') || 'biweekly',
    // Nombre / cédula
    ...opt('secondName'),
    ...opt('secondSurname'),
    ...opt('marriedSurname'),
    ...opt('idPrefix'),
    ...opt('idProvince'),
    ...opt('idVolume'),
    ...opt('idFolio'),
    ...opt('socialSecurityNumber'),
    // Datos personales
    ...opt('sex'),
    ...opt('maritalStatus'),
    ...opt('nationality'),
    ...opt('birthDate'),
    ...opt('birthPlace'),
    // Contacto
    ...opt('email'),
    ...opt('personalEmail'),
    ...opt('phone'),
    // Dirección
    ...opt('addressProvince'),
    ...opt('addressDistrict'),
    ...opt('addressTownship'),
    ...opt('address'),
    ...opt('otherAddress'),
    // Estructura / cargo
    ...opt('positionId'),
    ...opt('jobTitleId'),
    ...opt('jobFunctionId'),
    ...opt('departmentId'),
    // Nombramiento / resolución / contrato
    ...opt('decreeNumber'),
    ...opt('resolutionNumber'),
    ...opt('decreeDate'),
    ...opt('resolutionDate'),
    ...opt('collaboratorNumber'),
    ...opt('externalUserRef'),
    ...opt('contractType'),
    ...opt('contractEndDate'),
    ...opt('irKey'),
    ...opt('weeklyBaseHours'),
    ...opt('observations'),
    ...opt('siacapPct'),
    // Baja / terminación
    ...opt('terminationDecree'),
    ...opt('terminationResolution'),
    ...opt('terminationDecreeDate'),
    ...opt('terminationResolutionDate'),
    ...opt('terminationReason'),
    // Tipos de planilla (multi)
    payrollTypeIds: payrollTypeIds.length > 0 ? payrollTypeIds : undefined,
    // Personal flags (Phase 2.D). The edit form always renders these
    // checkboxes, so an absent value means "unchecked", not "untouched".
    hasOwnDisability: has('hasOwnDisability'),
    requiresAttendanceMarking: has('requiresAttendanceMarking'),
    canRead: has('canRead'),
    canWrite: has('canWrite'),
    // Photo / scanned ID: only forward when the form actually carried the
    // field, so a partial submit never wipes an existing image.
    ...(form.has('photo') ? { photo: g('photo') || null } : {}),
    ...(form.has('scannedId') ? { scannedId: g('scannedId') || null } : {}),
    // Datos bancarios (tesorería)
    ...opt('bankId'),
    ...opt('accountNumber'),
    ...opt('accountType'),
    paymentMethod: g('paymentMethod') || 'check',
    ...(customFields !== undefined ? { customFields } : {}),
  }

  if (
    !body.code ||
    !body.firstName ||
    !body.lastName ||
    !body.idNumber ||
    !body.hireDate ||
    !body.baseSalary
  ) {
    return fail('missing-fields')
  }

  let res: Response
  try {
    res = await fetch(`${API_URL}/employees/${id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `auth=${authCookie}`,
        'X-Tenant': TENANT,
      },
      body: JSON.stringify(body),
    })
  } catch {
    return fail('server-error', 502)
  }

  if (res.status === 401) return redirect('/login')

  if (res.ok) {
    return ok(`/employees/${id}?success=1`)
  }

  const data = (await res.json().catch(() => ({}))) as { error?: string }
  const msg = (data.error ?? '').toLowerCase()

  if (msg.includes('ocupada') || msg.includes('position_occupied')) {
    return fail('position_occupied', res.status)
  }
  if (msg.includes('salario')) {
    return fail('salary_max', res.status)
  }
  if (msg.includes('tipo de planilla')) {
    return fail('no_payroll_type', res.status)
  }
  if (msg.includes('code') || res.status === 409) {
    return fail('code_taken', 409)
  }
  if (msg.includes('cédula') || msg.includes('id number')) {
    return fail('id_taken', 409)
  }
  return fail('server-error', res.status)
}
