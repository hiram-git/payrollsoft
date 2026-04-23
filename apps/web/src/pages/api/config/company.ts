import type { APIRoute } from 'astro'

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'
const TENANT = 'demo'

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const authCookie = cookies.get('auth')?.value
  if (!authCookie) return redirect('/login')

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
    tipoInstitucion: g('tipoInstitucion') || 'privada',
    currencyCode: g('currencyCode') || 'USD',
    currencySymbol: g('currencySymbol') || '$',
    mailHost: gn('mailHost'),
    mailPort: Number(g('mailPort')) || 587,
    mailEncryption: g('mailEncryption') || 'tls',
    mailUsername: gn('mailUsername'),
    mailFromAddress: gn('mailFromAddress'),
    mailFromName: gn('mailFromName'),
    elaboradoPor: gn('elaboradoPor'),
    cargoElaborador: g('cargoElaborador') || 'Especialista en Planillas',
    jefeRecursosHumanos: gn('jefeRecursosHumanos'),
    cargoJefeRrhh: g('cargoJefeRrhh') || 'Jefe de Recursos Humanos',
    // Logos: base64 data URLs or empty string → null
    logoEmpresa: gn('logoEmpresa'),
    logoIzquierdoReportes: gn('logoIzquierdoReportes'),
    logoDerechoReportes: gn('logoDerechoReportes'),
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
