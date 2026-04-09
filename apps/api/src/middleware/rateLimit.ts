import { Elysia } from 'elysia'

type WindowEntry = {
  count: number
  resetAt: number
}

/**
 * In-memory sliding-window rate limiter.
 *
 * Stores counters per key (typically IP address) in a Map.
 * The Map is shared across all instances of the plugin within the same process.
 *
 * Note: for multi-process deployments this should be replaced with a
 *       Redis-backed implementation (Phase 6).
 */
const store = new Map<string, WindowEntry>()

/** Periodic cleanup to prevent the store from growing indefinitely. */
setInterval(
  () => {
    const now = Date.now()
    for (const [key, entry] of store) {
      if (now > entry.resetAt) store.delete(key)
    }
  },
  60_000 // run every minute
)

/**
 * Check and increment the rate limit counter for a given key.
 * Returns true if the request is allowed, false if the limit is exceeded.
 */
export function checkRateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now()
  const entry = store.get(key)

  if (!entry || now > entry.resetAt) {
    store.set(key, { count: 1, resetAt: now + windowMs })
    return true
  }

  if (entry.count >= max) return false

  entry.count++
  return true
}

/** Extract the client IP from the request, respecting X-Forwarded-For. */
export function getClientIp(request: Request): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    'unknown'
  )
}

/**
 * Elysia plugin: global rate limiter (100 req/min per IP).
 * Attach to the root app before any routes.
 */
export const globalRateLimit = new Elysia({ name: 'global-rate-limit' }).onRequest(
  ({ request, set }) => {
    const ip = getClientIp(request)
    if (!checkRateLimit(`global:${ip}`, 100, 60_000)) {
      set.status = 429
      return {
        success: false,
        error: 'Too many requests. Please slow down.',
        retryAfter: 60,
      }
    }
  }
)

/**
 * Stricter rate limiter for auth endpoints: 10 req/min per IP.
 * Use as `beforeHandle` in the login route.
 */
export function loginRateLimit({
  request,
  set,
}: {
  request: Request
  set: { status: number | string }
}) {
  const ip = getClientIp(request)
  if (!checkRateLimit(`login:${ip}`, 10, 60_000)) {
    set.status = 429
    return {
      success: false,
      error: 'Too many login attempts. Try again in a minute.',
      retryAfter: 60,
    }
  }
}
