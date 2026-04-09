import { describe, expect, it } from 'bun:test'
import { ROLE_HIERARCHY, hasRole } from '@payroll/db'
import { hashPassword } from '../../../lib/password'
import { cookieOptions, verifyTenantLogin } from '../service'

// ─── Role hierarchy tests ─────────────────────────────────────────────────────

describe('hasRole', () => {
  it('SUPER_ADMIN has the highest level', () => {
    expect(ROLE_HIERARCHY.SUPER_ADMIN).toBeGreaterThan(ROLE_HIERARCHY.ADMIN)
    expect(ROLE_HIERARCHY.ADMIN).toBeGreaterThan(ROLE_HIERARCHY.HR)
    expect(ROLE_HIERARCHY.HR).toBeGreaterThan(ROLE_HIERARCHY.ACCOUNTANT)
    expect(ROLE_HIERARCHY.ACCOUNTANT).toBeGreaterThan(ROLE_HIERARCHY.VIEWER)
  })

  it('hasRole returns true when user has equal role', () => {
    expect(hasRole('ADMIN', 'ADMIN')).toBe(true)
    expect(hasRole('VIEWER', 'VIEWER')).toBe(true)
  })

  it('hasRole returns true when user has higher role', () => {
    expect(hasRole('ADMIN', 'HR')).toBe(true)
    expect(hasRole('SUPER_ADMIN', 'VIEWER')).toBe(true)
  })

  it('hasRole returns false when user has lower role', () => {
    expect(hasRole('VIEWER', 'ADMIN')).toBe(false)
    expect(hasRole('HR', 'ADMIN')).toBe(false)
  })

  it('hasRole returns false for unknown role', () => {
    expect(hasRole('UNKNOWN', 'VIEWER')).toBe(false)
  })
})

// ─── cookieOptions ────────────────────────────────────────────────────────────

describe('cookieOptions', () => {
  it('sets secure=false in development', () => {
    const opts = cookieOptions(false)
    expect(opts.secure).toBe(false)
    expect(opts.httpOnly).toBe(true)
    expect(opts.sameSite).toBe('lax')
  })

  it('sets secure=true in production', () => {
    const opts = cookieOptions(true)
    expect(opts.secure).toBe(true)
  })

  it('sets a 7-day maxAge', () => {
    const opts = cookieOptions(false)
    expect(opts.maxAge).toBe(7 * 24 * 60 * 60)
  })
})

// ─── verifyTenantLogin (mocked DB) ───────────────────────────────────────────

describe('verifyTenantLogin', () => {
  it('returns null for non-existent user', async () => {
    const mockDb = {
      select: () => ({
        from: () => ({
          where: () => Promise.resolve([]),
        }),
      }),
    }
    const result = await verifyTenantLogin(mockDb, 'ghost@acme.com', 'pass', 'acme')
    expect(result).toBeNull()
  })

  it('returns null for inactive user', async () => {
    const mockDb = {
      select: () => ({
        from: () => ({
          where: () =>
            Promise.resolve([
              {
                id: 'u1',
                email: 'user@acme.com',
                passwordHash: '$hash',
                isActive: false,
                role: 'VIEWER',
              },
            ]),
        }),
      }),
    }
    const result = await verifyTenantLogin(mockDb, 'user@acme.com', 'anypass', 'acme')
    expect(result).toBeNull()
  })

  it('returns AuthUser on valid credentials', async () => {
    const password = 'super-secret-123'
    const hash = await hashPassword(password)

    const mockDb = {
      select: () => ({
        from: () => ({
          where: () =>
            Promise.resolve([
              {
                id: 'user-uuid',
                email: 'admin@acme.com',
                passwordHash: hash,
                isActive: true,
                role: 'ADMIN',
              },
            ]),
        }),
      }),
    }

    const result = await verifyTenantLogin(mockDb, 'admin@acme.com', password, 'acme')
    expect(result).not.toBeNull()
    expect(result?.userId).toBe('user-uuid')
    expect(result?.role).toBe('ADMIN')
    expect(result?.tenantId).toBe('acme')
    expect(result?.type).toBe('user')
  })

  it('returns null for wrong password', async () => {
    const hash = await hashPassword('correct-password')

    const mockDb = {
      select: () => ({
        from: () => ({
          where: () =>
            Promise.resolve([
              {
                id: 'u1',
                email: 'user@test.com',
                passwordHash: hash,
                isActive: true,
                role: 'VIEWER',
              },
            ]),
        }),
      }),
    }

    const result = await verifyTenantLogin(mockDb, 'user@test.com', 'wrong-password', 'test')
    expect(result).toBeNull()
  })
})
