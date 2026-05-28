import type { APIRoute } from 'astro'
import { resolveTenantSlugFromCookie } from '../../../lib/tenant-slug'

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const authCookie = cookies.get('auth')?.value
  if (!authCookie) return redirect('/login')
  const TENANT = resolveTenantSlugFromCookie(authCookie)

  const form = await request.formData()
  const g = (k: string) => form.get(k)?.toString().trim() ?? ''
  const gn = (k: string): string | null => {
    const v = form.get(k)?.toString().trim()
    return v || null
  }

  const companyName = g('companyName')
  const ruc = g('ruc')

  if (!companyName || !ruc) {
    return redirect('/config/company?error=missing-required')
  }

  // SMTP password: blank means "keep existing" (signal with undefined-like)
  // We send null explicitly only if the user clears it (not possible via form directly,
  // but we preserve the keep-existing behaviour by omitting the field when blank).
  const rawPassword = form.get('mailPassword')?.toString() ?? ''

  const body: Record<string, unknown> = {
    companyName,
    ruc,
    legalRepresentative: gn('legalRepresentative'),
    address: gn('address'),
    phone: gn('phone'),
    email: gn('email'),
    institutionType: g('tipoInstitucion') || 'privada',
    currencyCode: g('currencyCode') || 'USD',
    currencySymbol: g('currencySymbol') || '$',
    mailHost: gn('mailHost'),
    mailPort: Number(g('mailPort')) || 587,
    mailEncryption: g('mailEncryption') || 'tls',
    mailUsername: gn('mailUsername'),
    mailFromAddress: gn('mailFromAddress'),
    mailFromName: gn('mailFromName'),
    preparedBy: gn('elaboradoPor'),
    preparerTitle: g('cargoElaborador') || 'Especialista en Planillas',
    hrDirectorName: gn('jefeRecursosHumanos'),
    hrDirectorTitle: g('cargoJefeRrhh') || 'Jefe de Recursos Humanos',
    // Logos: base64 data URLs or empty string → null
    companyLogo: gn('companyLogo'),
    reportLogoLeft: gn('reportLogoLeft'),
    reportLogoRight: gn('reportLogoRight'),
    // Per-tenant Planilla PDF lifecycle. The API validates the value
    // against an allow-list and falls back to the existing setting if
    // anything unexpected slips through.
    payrollReportMode: g('payrollReportMode') || 'on_demand',
  }

  // Only include mailPassword if the user supplied a value (blank = keep existing)
  if (rawPassword) {
    body.mailPassword = rawPassword
  }

  let res: Response
  try {
    res = await fetch(`${API_URL}/company`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `auth=${authCookie}`,
        'X-Tenant': TENANT,
      },
      body: JSON.stringify(body),
    })
  } catch {
    return redirect('/config/company?error=server-error')
  }

  if (res.status === 401) return redirect('/login')
  if (res.ok) return redirect('/config/company?success=1')
  return redirect('/config/company?error=server-error')
}
