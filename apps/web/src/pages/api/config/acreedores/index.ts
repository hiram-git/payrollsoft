import type { APIRoute } from 'astro'
import { resolveTenantSlugFromCookie } from '../../../../lib/tenant-slug'

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const authCookie = cookies.get('auth')?.value
  if (!authCookie) return redirect('/login')
  const TENANT = resolveTenantSlugFromCookie(authCookie)

  const form = await request.formData()
  const code = form.get('code')?.toString().trim() ?? ''
  const name = form.get('name')?.toString().trim() ?? ''

  if (!code || !name) {
    return redirect('/config/acreedores/new?error=missing-fields')
  }

  const str = (k: string): string | null => {
    const v = form.get(k)?.toString().trim()
    return v ? v : null
  }
  const paymentMethod = (form.get('paymentMethod')?.toString() || 'check') as
    | 'ach'
    | 'check'
    | 'cash'
  const isAch = paymentMethod === 'ach'

  let res: Response
  try {
    res = await fetch(`${API_URL}/creditors`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `auth=${authCookie}`,
        'X-Tenant': TENANT,
      },
      body: JSON.stringify({
        code,
        name,
        paymentMethod,
        bankId: isAch ? str('bankId') : null,
        accountNumber: isAch ? str('accountNumber') : null,
        accountType: isAch ? str('accountType') : null,
        beneficiaryName: str('beneficiaryName'),
      }),
    })
  } catch {
    return redirect('/config/acreedores/new?error=server-error')
  }

  if (res.status === 401) return redirect('/login')
  if (res.ok) return redirect('/config/acreedores?success=1')

  const data = (await res.json().catch(() => ({}))) as { error?: string }
  const msg = (data.error ?? '').toLowerCase()

  if (res.status === 409 || msg.includes('código') || msg.includes('code')) {
    if (msg.includes('concepto')) {
      return redirect('/config/acreedores/new?error=concept_code_taken')
    }
    return redirect('/config/acreedores/new?error=code_taken')
  }
  return redirect('/config/acreedores/new?error=server-error')
}
