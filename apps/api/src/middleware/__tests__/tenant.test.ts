import { describe, expect, it } from 'bun:test'
import type { AuthUser } from '../auth'
import { guardTenantMatchesToken } from '../tenant'

const tenantUser = (overrides: Partial<AuthUser> = {}): AuthUser => ({
  userId: 'user-1',
  tenantId: 'demo',
  tenantSlug: 'demo',
  role: 'ADMIN',
  type: 'user',
  permissions: [],
  permissionsVersion: 1,
  ...overrides,
})

const superAdmin: AuthUser = {
  userId: 'sa-1',
  tenantId: '*',
  role: 'SUPER_ADMIN',
  type: 'super_admin',
}

describe('guardTenantMatchesToken', () => {
  it('rejects anonymous requests with 401', () => {
    const set = { status: 0 as number | string }
    const result = guardTenantMatchesToken({ user: null, tenantSlug: 'demo', set })
    expect(set.status).toBe(401)
    expect(result).toMatchObject({ success: false })
  })

  it('rejects tenant users without an X-Tenant resolution', () => {
    const set = { status: 0 as number | string }
    const result = guardTenantMatchesToken({
      user: tenantUser(),
      tenantSlug: undefined,
      set,
    })
    expect(set.status).toBe(400)
    expect(result).toMatchObject({ success: false })
  })

  it('allows when JWT tenantSlug matches the request slug', () => {
    const set = { status: 0 as number | string }
    const result = guardTenantMatchesToken({
      user: tenantUser({ tenantSlug: 'acme' }),
      tenantSlug: 'acme',
      set,
    })
    expect(result).toBeUndefined()
    expect(set.status).toBe(0)
  })

  it('blocks cross-tenant token replay with 403', () => {
    const set = { status: 0 as number | string }
    // Token was issued for tenant "acme" but the request resolved as "rival".
    const result = guardTenantMatchesToken({
      user: tenantUser({ tenantSlug: 'acme' }),
      tenantSlug: 'rival',
      set,
    })
    expect(set.status).toBe(403)
    expect(result).toMatchObject({
      success: false,
      error: 'Forbidden: tenant mismatch',
    })
  })

  it('allows super-admins to act against any tenant', () => {
    const set = { status: 0 as number | string }
    const result = guardTenantMatchesToken({
      user: superAdmin,
      tenantSlug: 'any-tenant',
      set,
    })
    expect(result).toBeUndefined()
    expect(set.status).toBe(0)
  })

  it('does not enforce mismatch when the JWT carries no tenantSlug (legacy)', () => {
    // Legacy tokens issued before Phase 3.3 don't carry tenantSlug; rather
    // than locking those users out we let the request through, trusting
    // that downstream guardPermission will deny anything sensitive.
    const set = { status: 0 as number | string }
    const result = guardTenantMatchesToken({
      user: tenantUser({ tenantSlug: undefined }),
      tenantSlug: 'acme',
      set,
    })
    expect(result).toBeUndefined()
    expect(set.status).toBe(0)
  })
})
