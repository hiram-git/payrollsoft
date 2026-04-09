import { Elysia } from 'elysia'
import { env } from '../config/env'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/**
 * CSRF protection via Origin header validation.
 *
 * Strategy: for all state-changing requests (POST, PUT, PATCH, DELETE),
 * verify the Origin header matches the configured WEB_URL.
 *
 * This works because:
 * - Browsers always send the Origin header on cross-origin requests
 * - The auth cookie is SameSite=Lax, which prevents most CSRF by itself
 * - Origin check adds an extra layer of defense
 *
 * API clients (mobile apps, curl) that don't send an Origin header are allowed
 * through — they're not vulnerable to CSRF since there's no browser session.
 */
export const csrfPlugin = new Elysia({ name: 'csrf' }).onRequest(({ request, set }) => {
  if (SAFE_METHODS.has(request.method.toUpperCase())) return

  const origin = request.headers.get('origin')
  if (!origin) return // Non-browser clients (mobile, CLI) — allow

  // Normalize: remove trailing slash for comparison
  const allowedOrigin = env.WEB_URL.replace(/\/$/, '')
  const requestOrigin = origin.replace(/\/$/, '')

  if (requestOrigin !== allowedOrigin) {
    set.status = 403
    return { success: false, error: 'CSRF check failed: invalid origin' }
  }
})
