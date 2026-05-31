import type { APIRoute } from 'astro'
import { resolveTenantSlugFromCookie } from '../../../../lib/tenant-slug'

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const authCookie = cookies.get('auth')?.value
  if (!authCookie) return redirect('/login')
  const TENANT = resolveTenantSlugFromCookie(authCookie)

  const form = await request.formData()
  const g = (k: string) => form.get(k)?.toString().trim() ?? ''

  const status = g('status')
  const body = {
    code: g('code'),
    name: g('name'),
    salary: g('salary'),
    overtimeAmount: g('overtimeAmount') || '0',
    representationAmount: g('representationAmount') || '0',
    jobTitleId: g('jobTitleId') || null,
    departmentId: g('departmentId') || null,
    jobFunctionId: g('jobFunctionId') || null,
    budgetItemId: g('budgetItemId') || null,
    overtimeBudgetItemId: g('overtimeBudgetItemId') || null,
    representationBudgetItemId: g('representationBudgetItemId') || null,
    thirteenthMonthBudgetItemId: g('thirteenthMonthBudgetItemId') || null,
    status: status === 'en_uso' || status === 'vacante' ? status : 'vacante',
  }

  if (!body.code || !body.name || !body.salary) {
    return redirect('/config/estructura/new?error=missing-fields')
  }

  let res: Response
  try {
    res = await fetch(`${API_URL}/positions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `auth=${authCookie}`,
        'X-Tenant': TENANT,
      },
      body: JSON.stringify(body),
    })
  } catch {
    return redirect('/config/estructura/new?error=server-error')
  }

  if (res.status === 401) return redirect('/login')
  if (res.ok) return redirect('/config/estructura?success=1')

  const data = (await res.json().catch(() => ({}))) as { error?: string }
  if (res.status === 409 || data.error === 'code_taken') {
    return redirect('/config/estructura/new?error=code_taken')
  }
  if (data.error === 'invalid_budget_item') {
    return redirect('/config/estructura/new?error=invalid_budget_item')
  }
  return redirect('/config/estructura/new?error=server-error')
}
