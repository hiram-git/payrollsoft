import { describe, expect, it } from 'bun:test'
import { tenantSchemaName, validateTenantSlug } from '../tenant-slug'

describe('validateTenantSlug', () => {
  it.each(['acme', 'demo', 'company-1', 'a1b', 'foo_bar', 'x'.repeat(50)])(
    'accepts valid slug %s',
    (slug) => {
      const result = validateTenantSlug(slug)
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.slug).toBe(slug)
    }
  )

  it('lowercases and trims the input', () => {
    const result = validateTenantSlug('  Acme-Co  ')
    expect(result).toEqual({ ok: true, slug: 'acme-co' })
  })

  it.each([
    ['', 'EMPTY'],
    [123, 'EMPTY'],
    ['ab', 'TOO_SHORT'],
    ['x'.repeat(51), 'TOO_LONG'],
    ['-acme', 'INVALID_FORMAT'],
    ['_acme', 'INVALID_FORMAT'],
    ['acme!', 'INVALID_FORMAT'],
    ['acme corp', 'INVALID_FORMAT'],
    ['acmé', 'INVALID_FORMAT'],
  ] as const)('rejects %p with error %s', (input, code) => {
    const result = validateTenantSlug(input)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe(code)
  })

  it.each([
    'public',
    'payroll_auth',
    'information_schema',
    'pg_catalog',
    'admin',
    'superadmin',
    'api',
    'www',
  ])('rejects reserved slug %s', (slug) => {
    const result = validateTenantSlug(slug)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('RESERVED')
  })

  it('rejects any slug starting with pg_', () => {
    const result = validateTenantSlug('pg_anything')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('RESERVED')
  })
})

describe('tenantSchemaName', () => {
  it('returns the prefixed schema name for a valid slug', () => {
    expect(tenantSchemaName('acme')).toBe('tenant_acme')
  })

  it('throws for an invalid slug', () => {
    expect(() => tenantSchemaName('public')).toThrow(/reserved/i)
    expect(() => tenantSchemaName('ab')).toThrow(/at least 3/i)
  })
})
