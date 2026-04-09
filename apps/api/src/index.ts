import { cors } from '@elysiajs/cors'
import { Elysia } from 'elysia'
import { env } from './config/env'
import { csrfPlugin } from './middleware/csrf'
import { globalRateLimit } from './middleware/rateLimit'
import { tenantPlugin } from './middleware/tenant'
import { authRoutes } from './modules/auth/routes'
import { employeeRoutes } from './modules/employees/routes'

const app = new Elysia()
  // ── Global middleware (order matters) ──────────────────────────────────────
  .use(
    cors({
      origin: env.WEB_URL,
      credentials: true,
      allowedHeaders: ['Content-Type', 'X-Tenant'],
    })
  )
  .use(globalRateLimit)
  .use(csrfPlugin)
  .use(tenantPlugin)

  // ── Routes ─────────────────────────────────────────────────────────────────
  .get('/health', ({ tenantSlug }) => ({
    status: 'ok',
    tenant: tenantSlug ?? 'public',
    version: '2.0.0',
    timestamp: new Date().toISOString(),
  }))
  .use(authRoutes)
  .use(employeeRoutes)

  // ── Start ───────────────────────────────────────────────────────────────────
  .listen(env.PORT)

console.log(`API running at http://localhost:${app.server?.port}`)

export type App = typeof app
