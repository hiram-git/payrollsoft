import { Elysia } from 'elysia'
import { getTenantDb, publicDb } from '../config/db'
import type { AuthUser } from './auth'

/**
 * Resolve the tenant for the current request and expose `db` + `tenantSlug`.
 * Slug is taken from the `X-Tenant` header first, then the host's leftmost
 * subdomain (skipped in local development where everything answers under
 * `localhost`).
 */
export const tenantPlugin = new Elysia({ name: 'tenant' }).derive(
  { as: 'global' },
  ({ headers }) => {
    const tenantHeader = headers['x-tenant']
    const host = headers.host ?? ''
    const subdomain = host.split('.')[0]

    const isLocalhost = subdomain === 'localhost' || subdomain === '127'
    const tenantSlug = tenantHeader ?? (!isLocalhost ? subdomain : undefined)

    return {
      tenantSlug,
      db: tenantSlug ? getTenantDb(tenantSlug) : publicDb,
    }
  }
)

/**
 * `beforeHandle` guard that rejects requests where the JWT's tenantSlug
 * disagrees with the slug derived from the request (header / subdomain).
 *
 * This is the primary defence against cross-tenant token replay: even if
 * someone gets hold of a valid cookie for tenant A, pointing it at tenant
 * B's host or X-Tenant header is a 403.
 *
 * Super-admins are exempt — they may legitimately operate against any
 * tenant via the superadmin routes; an additional `X-Acting-Tenant` flow
 * (recorded in super_admin_audit) is the channel for impersonation.
 */
export function guardTenantMatchesToken({
  user,
  tenantSlug,
  set,
}: {
  user: AuthUser | null
  tenantSlug?: string
  set: { status: number | string }
}) {
  if (!user) {
    set.status = 401
    return { success: false, error: 'Unauthorized' }
  }
  if (user.type === 'super_admin') return
  if (!tenantSlug) {
    set.status = 400
    return { success: false, error: 'Tenant not identified. Use X-Tenant header.' }
  }
  if (user.tenantSlug && user.tenantSlug !== tenantSlug) {
    set.status = 403
    return { success: false, error: 'Forbidden: tenant mismatch' }
  }
}
