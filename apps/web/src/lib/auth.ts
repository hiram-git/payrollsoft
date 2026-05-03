import type { PermissionCode } from '@payroll/types'
import type { AstroCookies } from 'astro'

/**
 * Server-side identity decoded from the auth cookie. Mirrors the JWT
 * payload signed in apps/api — we do NOT verify the signature here
 * (that's the API's job on every protected call), this is purely for
 * UI personalisation: rendering the user's name, deciding which
 * sidebar entries to show, etc.
 *
 * If you need a hard authorization decision, call the API and let
 * guardPermission do the verification — never trust this struct on
 * its own.
 */
export type ServerIdentity = {
  userId: string
  email: string | null
  name: string | null
  role: string | null
  type: 'user' | 'super_admin' | null
  tenantId: string | null
  tenantSlug: string | null
  permissions: PermissionCode[]
  permissionsVersion: number
  /** When set, the JWT was minted by the super-admin impersonation flow. */
  impersonatedBy: { superAdminId: string; superAdminEmail?: string } | null
  raw: string
}

const EMPTY_IDENTITY: ServerIdentity = {
  userId: '',
  email: null,
  name: null,
  role: null,
  type: null,
  tenantId: null,
  tenantSlug: null,
  permissions: [],
  permissionsVersion: 0,
  impersonatedBy: null,
  raw: '',
}

/**
 * Decode the JWT carried by the `auth` cookie into an identity. Returns
 * `null` if the cookie is missing or unparseable. Never throws.
 */
export function getIdentity(cookies: AstroCookies): ServerIdentity | null {
  const raw = cookies.get('auth')?.value
  if (!raw) return null
  const parts = raw.split('.')
  if (parts.length !== 3) return null
  try {
    const payload = JSON.parse(
      Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
    ) as Partial<{
      userId: string
      email: string
      name: string
      role: string
      type: 'user' | 'super_admin'
      tenantId: string
      tenantSlug: string
      permissions: PermissionCode[]
      permissionsVersion: number
      impersonatedBy: { superAdminId: string; superAdminEmail?: string }
    }>
    return {
      ...EMPTY_IDENTITY,
      userId: payload.userId ?? '',
      email: payload.email ?? null,
      name: payload.name ?? null,
      role: payload.role ?? null,
      type: payload.type ?? null,
      tenantId: payload.tenantId ?? null,
      tenantSlug: payload.tenantSlug ?? null,
      permissions: payload.permissions ?? [],
      permissionsVersion: payload.permissionsVersion ?? 0,
      impersonatedBy: payload.impersonatedBy ?? null,
      raw,
    }
  } catch {
    return null
  }
}

/**
 * `true` when the identity holds every supplied permission. Super admins
 * implicitly satisfy any tenant-scope check; an absent identity always
 * fails. Mirrors apps/api userHasPermissions so UI gates and backend
 * guards stay in sync.
 */
export function can(
  identity: ServerIdentity | null,
  ...required: readonly PermissionCode[]
): boolean {
  if (!identity) return false
  if (identity.type === 'super_admin') return true
  if (required.length === 0) return true
  const granted = new Set(identity.permissions)
  return required.every((p) => granted.has(p))
}

/** True if any of the supplied permissions is present (OR semantics). */
export function canAny(
  identity: ServerIdentity | null,
  ...required: readonly PermissionCode[]
): boolean {
  if (!identity) return false
  if (identity.type === 'super_admin') return true
  if (required.length === 0) return true
  const granted = new Set(identity.permissions)
  return required.some((p) => granted.has(p))
}

/** Friendly human label for a JWT role (legacy field kept for the topbar). */
export function roleLabel(role: string | null): string {
  switch (role) {
    case 'SUPER_ADMIN':
      return 'Super Admin'
    case 'ADMIN':
      return 'Administrador'
    case 'HR':
      return 'Recursos Humanos'
    case 'ACCOUNTANT':
      return 'Contabilidad'
    case 'VIEWER':
      return 'Visor'
    default:
      return ''
  }
}

/** Initials for the avatar pill. */
export function initials(identity: ServerIdentity | null): string {
  if (!identity) return 'U'
  const source = identity.name ?? identity.email ?? ''
  if (!source) return 'U'
  const parts = source.trim().split(/\s+/)
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
  }
  return source[0].toUpperCase()
}
