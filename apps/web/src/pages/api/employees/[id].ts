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

  const body: Record<string, unknown> = {
    code: g('code'),
    firstName: g('firstName'),
    lastName: g('lastName'),
    idNumber: g('idNumber'),
    socialSecurityNumber: g('socialSecurityNumber') || null,
    email: g('email') || null,
    phone: g('phone') || null,
    positionId: g('positionId') || null,
    jobTitleId: g('jobTitleId') || null,
    jobFunctionId: g('jobFunctionId') || null,
    departmentId: g('departmentId') || null,
    hireDate: g('hireDate'),
    baseSalary: g('baseSalary'),
    payFrequency: g('payFrequency') || 'biweekly',
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
    // Datos bancarios (tesorería) — string vacío se mapea a null
    bankId: g('bankId') || null,
    accountNumber: g('accountNumber') || null,
    accountType: g('accountType') || null,
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
    return redirect(`/employees/${id}?error=missing-fields`)
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
    return redirect(`/employees/${id}?error=server-error`)
  }

  if (res.status === 401) return redirect('/login')

  if (res.ok) {
    return redirect(`/employees/${id}?success=1`)
  }

  const data = (await res.json().catch(() => ({}))) as { error?: string }
  const msg = data.error ?? ''

  if (msg.toLowerCase().includes('salario')) {
    return redirect(`/employees/${id}?error=salary_max`)
  }
  if (msg.toLowerCase().includes('tipo de planilla')) {
    return redirect(`/employees/${id}?error=no_payroll_type`)
  }
  if (msg.toLowerCase().includes('code') || res.status === 409) {
    return redirect(`/employees/${id}?error=code_taken`)
  }
  if (msg.toLowerCase().includes('cédula') || msg.toLowerCase().includes('id number')) {
    return redirect(`/employees/${id}?error=id_taken`)
  }
  return redirect(`/employees/${id}?error=server-error`)
}
