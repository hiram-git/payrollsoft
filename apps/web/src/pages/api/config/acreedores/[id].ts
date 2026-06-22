import type { APIRoute } from 'astro'
import { resolveTenantSlugFromCookie } from '../../../../lib/tenant-slug'

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'

export const POST: APIRoute = async ({ request, params, cookies, redirect }) => {
  const authCookie = cookies.get('auth')?.value
  if (!authCookie) return redirect('/login')
  const TENANT = resolveTenantSlugFromCookie(authCookie)

  const { id } = params
  const form = await request.formData()
  const method = form.get('_method')?.toString()

  if (method === 'PUT') {
    const name = form.get('name')?.toString().trim() ?? ''
    if (!name) {
      return redirect(`/config/acreedores/${id}?error=missing-fields`)
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
      res = await fetch(`${API_URL}/creditors/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `auth=${authCookie}`,
          'X-Tenant': TENANT,
        },
        body: JSON.stringify({
          name,
          paymentMethod,
          bankId: isAch ? str('bankId') : null,
          accountNumber: isAch ? str('accountNumber') : null,
          accountType: isAch ? str('accountType') : null,
          beneficiaryName: str('beneficiaryName'),
        }),
      })
    } catch {
      return redirect(`/config/acreedores/${id}?error=server-error`)
    }

    if (res.status === 401) return redirect('/login')
    if (res.ok) return redirect(`/config/acreedores/${id}?success=1`)
    return redirect(`/config/acreedores/${id}?error=server-error`)
  }

  if (method === 'DEACTIVATE') {
    try {
      await fetch(`${API_URL}/creditors/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `auth=${authCookie}`,
          'X-Tenant': TENANT,
        },
        body: JSON.stringify({ isActive: false }),
      })
    } catch {
      // ignore — redirect regardless
    }
    return redirect('/config/acreedores')
  }

  if (method === 'ACTIVATE') {
    try {
      await fetch(`${API_URL}/creditors/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `auth=${authCookie}`,
          'X-Tenant': TENANT,
        },
        body: JSON.stringify({ isActive: true }),
      })
    } catch {
      // ignore — redirect regardless
    }
    return redirect('/config/acreedores')
  }

  return redirect('/config/acreedores')
}
