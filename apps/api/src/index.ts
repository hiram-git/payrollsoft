import { cors } from '@elysiajs/cors'
import { Elysia } from 'elysia'
import { env } from './config/env'
import { tenantPlugin } from './middleware/tenant'

const app = new Elysia()
  .use(
    cors({
      origin: env.WEB_URL,
      credentials: true,
    })
  )
  .use(tenantPlugin)
  .get('/health', ({ tenantSlug }) => ({
    status: 'ok',
    tenant: tenantSlug ?? 'public',
    timestamp: new Date().toISOString(),
  }))
  .listen(env.PORT)

console.log(`🦊 API running at http://localhost:${app.server?.port}`)

export type App = typeof app
