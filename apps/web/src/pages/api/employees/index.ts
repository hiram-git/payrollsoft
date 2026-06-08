import type { APIRoute } from 'astro'
import { resolveTenantSlugFromCookie } from '../../../lib/tenant-slug'

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const authCookie = cookies.get('auth')?.value
  if (!authCookie) return redirect('/login')
  const TENANT = resolveTenantSlugFromCookie(authCookie)

  const form = await request.formData()
  const g = (k: string) => form.get(k)?.toString().trim() ?? ''
  const has = (k: string) => form.get(k) === 'on' || form.get(k) === 'true'

  // AJAX submit (X-Form-Submit) gets JSON {ok, error?, redirect?} so the form
  // keeps its state on error; classic POST keeps redirecting for no-JS.
  const isAjax = request.headers.get('X-Form-Submit') === '1'
  const fail = (code: string, status = 400) =>
    isAjax
      ? new Response(JSON.stringify({ ok: false, error: code }), {
          status,
          headers: { 'Content-Type': 'application/json' },
        })
      : redirect(`/employees/new?error=${code}`)
  const ok = (to: string) =>
    isAjax
      ? new Response(JSON.stringify({ ok: true, redirect: to }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      : redirect(to)

  const payrollTypeIds = form.getAll('payrollTypeIds[]').map(String).filter(Boolean)

  const paymentMethodRaw = g('paymentMethod')
  const paymentMethod =
    paymentMethodRaw === 'ach' || paymentMethodRaw === 'check' || paymentMethodRaw === 'cash'
      ? paymentMethodRaw
      : undefined

  const body = {
    code: g('code'),
    firstName: g('firstName'),
    lastName: g('lastName'),
    idNumber: g('idNumber'),
    socialSecurityNumber: g('socialSecurityNumber') || null,
    sex: g('sex') || null,
    nationality: g('nationality') || null,
    email: g('email') || null,
    phone: g('phone') || null,
    positionId: g('positionId') || null,
    jobTitleId: g('jobTitleId') || null,
    jobFunctionId: g('jobFunctionId') || null,
    departmentId: g('departmentId') || null,
    hireDate: g('hireDate'),
    baseSalary: g('baseSalary'),
    payFrequency: (g('payFrequency') || 'biweekly') as 'biweekly' | 'monthly' | 'weekly',
    contractType: g('contractType') || null,
    paymentMethod,
    payrollTypeIds: payrollTypeIds.length > 0 ? payrollTypeIds : undefined,
    // Personal flags + media (Phase 2.D). Unchecked checkboxes don't post,
    // so the booleans default to their schema default server-side.
    hasOwnDisability: has('hasOwnDisability'),
    requiresAttendanceMarking: has('requiresAttendanceMarking'),
    canRead: has('canRead'),
    canWrite: has('canWrite'),
    photo: g('photo') || null,
    scannedId: g('scannedId') || null,
  }

  // Basic required-field check
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
    res = await fetch(`${API_URL}/employees`, {
      method: 'POST',
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

  if (res.ok) {
    return ok('/employees')
  }

  const data = (await res.json().catch(() => ({}))) as { error?: string }
  const msg = (data.error ?? '').toLowerCase()

  if (msg.includes('ocupada') || msg.includes('position_occupied')) {
    return fail('position_occupied', res.status)
  }
  if (msg.includes('salario')) {
    return fail('salary_max', res.status)
  }
  if (msg.includes('code') || res.status === 409) {
    return fail('code_taken', 409)
  }
  if (msg.includes('cédula') || msg.includes('id number')) {
    return fail('id_taken', 409)
  }
  return fail('server-error', res.status)
}
