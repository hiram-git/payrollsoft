import { describe, expect, it } from 'bun:test'
import { checkRateLimit, getClientIp } from '../rateLimit'

describe('checkRateLimit', () => {
  it('allows requests under the limit', () => {
    const key = `test-allow-${Date.now()}`
    for (let i = 0; i < 5; i++) {
      expect(checkRateLimit(key, 5, 60_000)).toBe(true)
    }
  })

  it('blocks the request that exceeds the limit', () => {
    const key = `test-block-${Date.now()}`
    for (let i = 0; i < 3; i++) checkRateLimit(key, 3, 60_000)
    expect(checkRateLimit(key, 3, 60_000)).toBe(false)
  })

  it('different keys are tracked independently', () => {
    const ts = Date.now()
    const keyA = `key-a-${ts}`
    const keyB = `key-b-${ts}`

    // Exhaust keyA
    for (let i = 0; i < 2; i++) checkRateLimit(keyA, 2, 60_000)
    expect(checkRateLimit(keyA, 2, 60_000)).toBe(false)

    // keyB should still be allowed
    expect(checkRateLimit(keyB, 2, 60_000)).toBe(true)
  })

  it('resets the counter after the window expires', async () => {
    const key = `test-reset-${Date.now()}`
    const windowMs = 50 // 50ms window for testing

    // Exhaust the limit
    checkRateLimit(key, 1, windowMs)
    expect(checkRateLimit(key, 1, windowMs)).toBe(false)

    // Wait for window to expire
    await Bun.sleep(60)

    // Should be allowed again
    expect(checkRateLimit(key, 1, windowMs)).toBe(true)
  })
})

describe('getClientIp', () => {
  it('reads X-Forwarded-For header', () => {
    const req = new Request('http://localhost/', {
      headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' },
    })
    expect(getClientIp(req)).toBe('1.2.3.4')
  })

  it('falls back to x-real-ip', () => {
    const req = new Request('http://localhost/', {
      headers: { 'x-real-ip': '9.10.11.12' },
    })
    expect(getClientIp(req)).toBe('9.10.11.12')
  })

  it('returns "unknown" when no IP headers present', () => {
    const req = new Request('http://localhost/')
    expect(getClientIp(req)).toBe('unknown')
  })
})
