import { Elysia } from 'elysia'
import { isAllowedOrigin } from '../config/origins'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/**
 * CSRF protection via Origin header validation.
 *
 * Strategy: for all state-changing requests (POST, PUT, PATCH, DELETE),
 * verify the Origin header is a trusted origin (the web app or an
 * allowed mobile/native origin — see config/origins.ts).
 *
 * This works because:
 * - Browsers always send the Origin header on cross-origin requests
 * - The auth cookie is SameSite=Lax, which prevents most CSRF by itself
 * - Origin check adds an extra layer of defense
 *
 * API clients (native mobile, CLI) that don't send an Origin header are
 * allowed through — they're not vulnerable to CSRF since there's no
 * ambient browser session. The Capacitor WebView DOES send an Origin
 * (e.g. capacitor://localhost), which is whitelisted via origins.ts.
 */
export const csrfPlugin = new Elysia({ name: 'csrf' }).onRequest(({ request, set }) => {
  if (SAFE_METHODS.has(request.method.toUpperCase())) return

  const origin = request.headers.get('origin')
  if (!origin) return // Non-browser clients (native mobile, CLI) — allow

  if (!isAllowedOrigin(origin)) {
    set.status = 403
    return { success: false, error: 'CSRF check failed: invalid origin' }
  }
})
