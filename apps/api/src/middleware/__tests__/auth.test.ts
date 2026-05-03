import { describe, expect, it } from 'bun:test'
import type { AuthUser } from '../auth'
import { guardAuth, guardPermission, guardSuperAdmin, userHasPermissions } from '../auth'

const tenantUser = (overrides: Partial<AuthUser> = {}): AuthUser => ({
  userId: 'user-1',
  tenantId: 'demo',
  tenantSlug: 'demo',
  role: 'ADMIN',
  type: 'user',
  permissions: ['employees:read', 'employees:create', 'payroll:read'],
  permissionsVersion: 1,
  ...overrides,
})

const superAdmin: AuthUser = {
  userId: 'sa-1',
  tenantId: '*',
  role: 'SUPER_ADMIN',
  type: 'super_admin',
}

describe('userHasPermissions', () => {
  it('returns false for an anonymous user', () => {
    expect(userHasPermissions(null, ['employees:read'])).toBe(false)
  })

  it('returns true for an empty required list (open by default)', () => {
    expect(userHasPermissions(tenantUser(), [])).toBe(true)
  })

  it('grants when the JWT carries the required code', () => {
    expect(userHasPermissions(tenantUser(), ['employees:read'])).toBe(true)
  })

  it('AND-combines: every required code must be present', () => {
    expect(userHasPermissions(tenantUser(), ['employees:read', 'payroll:read'])).toBe(true)
    expect(userHasPermissions(tenantUser(), ['employees:read', 'payroll:approve'])).toBe(false)
  })

  it('rejects users whose JWT has no permissions field at all', () => {
    expect(userHasPermissions(tenantUser({ permissions: undefined }), ['employees:read'])).toBe(
      false
    )
  })

  it('super-admins implicitly satisfy every check', () => {
    expect(userHasPermissions(superAdmin, ['payroll:approve', 'tenants:create'])).toBe(true)
  })
})

describe('guardAuth', () => {
  it('rejects anonymous requests with 401', () => {
    const set = { status: 0 as number | string }
    const result = guardAuth({ user: null, set })
    expect(set.status).toBe(401)
    expect(result).toEqual({ success: false, error: 'Unauthorized' })
  })

  it('allows authenticated requests through', () => {
    const set = { status: 0 as number | string }
    const result = guardAuth({ user: tenantUser(), set })
    expect(result).toBeUndefined()
    expect(set.status).toBe(0)
  })
})

describe('guardSuperAdmin', () => {
  it('accepts type=super_admin', () => {
    const set = { status: 0 as number | string }
    expect(guardSuperAdmin({ user: superAdmin, set })).toBeUndefined()
  })

  it('rejects tenant users with 403', () => {
    const set = { status: 0 as number | string }
    const result = guardSuperAdmin({ user: tenantUser(), set })
    expect(set.status).toBe(403)
    expect(result).toMatchObject({ success: false })
  })

  it('rejects anonymous with 401', () => {
    const set = { status: 0 as number | string }
    const result = guardSuperAdmin({ user: null, set })
    expect(set.status).toBe(401)
    expect(result).toMatchObject({ success: false })
  })
})

describe('guardPermission', () => {
  it('rejects anonymous with 401', () => {
    const set = { status: 0 as number | string }
    const guard = guardPermission('employees:read')
    const result = guard({ user: null, set })
    expect(set.status).toBe(401)
    expect(result).toMatchObject({ success: false })
  })

  it('accepts a tenant user holding the code', () => {
    const set = { status: 0 as number | string }
    const guard = guardPermission('employees:read')
    expect(guard({ user: tenantUser(), set })).toBeUndefined()
    expect(set.status).toBe(0)
  })

  it('rejects a tenant user missing the code with 403 and reports it', () => {
    const set = { status: 0 as number | string }
    const guard = guardPermission('payroll:approve')
    const result = guard({ user: tenantUser(), set })
    expect(set.status).toBe(403)
    expect(result).toMatchObject({
      success: false,
      missing: ['payroll:approve'],
    })
  })

  it('AND-combines multiple codes and lists every missing one', () => {
    const set = { status: 0 as number | string }
    const guard = guardPermission('employees:read', 'payroll:approve', 'roles:assign')
    const result = guard({ user: tenantUser(), set })
    expect(set.status).toBe(403)
    expect(result).toMatchObject({
      success: false,
      missing: ['payroll:approve', 'roles:assign'],
    })
  })

  it('super-admins bypass the check even on global codes', () => {
    const set = { status: 0 as number | string }
    const guard = guardPermission('tenants:create')
    expect(guard({ user: superAdmin, set })).toBeUndefined()
  })
})
