import { describe, expect, it } from 'bun:test'
import { hashPassword, verifyPassword } from '../password'

describe('password utils', () => {
  it('hashes a password and produces a non-empty string', async () => {
    const hash = await hashPassword('secure-password-123')
    expect(typeof hash).toBe('string')
    expect(hash.length).toBeGreaterThan(20)
    expect(hash).not.toBe('secure-password-123')
  })

  it('produces different hashes for the same password (salt)', async () => {
    const h1 = await hashPassword('same-password')
    const h2 = await hashPassword('same-password')
    expect(h1).not.toBe(h2)
  })

  it('verifyPassword returns true for matching password', async () => {
    const hash = await hashPassword('correct-horse-battery')
    const valid = await verifyPassword('correct-horse-battery', hash)
    expect(valid).toBe(true)
  })

  it('verifyPassword returns false for wrong password', async () => {
    const hash = await hashPassword('correct-horse-battery')
    const valid = await verifyPassword('wrong-password', hash)
    expect(valid).toBe(false)
  })

  it('verifyPassword returns false for empty string against a real hash', async () => {
    const hash = await hashPassword('some-password')
    const valid = await verifyPassword('', hash)
    expect(valid).toBe(false)
  })
})
