import type { AstroCookies } from 'astro'

export type PortalIdentity = {
  employeeId: string
  employeeCode: string
  name: string
  idNumber: string
  departmentId: string | null
  tenantSlug: string
  raw: string
}

export function getPortalIdentity(cookies: AstroCookies): PortalIdentity | null {
  const raw = cookies.get('portal_auth')?.value
  if (!raw) return null
  const parts = raw.split('.')
  if (parts.length !== 3) return null
  try {
    const payload = JSON.parse(
      Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
    ) as Partial<{
      type: string
      employeeId: string
      employeeCode: string
      name: string
      idNumber: string
      departmentId: string | null
      tenantSlug: string
    }>
    if (payload.type !== 'employee') return null
    return {
      employeeId: payload.employeeId ?? '',
      employeeCode: payload.employeeCode ?? '',
      name: payload.name ?? '',
      idNumber: payload.idNumber ?? '',
      departmentId: payload.departmentId ?? null,
      tenantSlug: payload.tenantSlug ?? '',
      raw,
    }
  } catch {
    return null
  }
}

export function portalInitials(identity: PortalIdentity | null): string {
  if (!identity?.name) return 'E'
  const parts = identity.name.trim().split(/\s+/)
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
  }
  return identity.name[0].toUpperCase()
}
