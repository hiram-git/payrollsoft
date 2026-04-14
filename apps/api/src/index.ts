import { cors } from '@elysiajs/cors'
import { Elysia } from 'elysia'
import { env } from './config/env'
import { csrfPlugin } from './middleware/csrf'
import { globalRateLimit } from './middleware/rateLimit'
import { tenantPlugin } from './middleware/tenant'
import { acumuladosRoutes } from './modules/acumulados/routes'
import { authRoutes } from './modules/auth/routes'
import { companyRoutes } from './modules/company/routes'
import { creditorRoutes } from './modules/creditors/routes'
import { cargosRoutes } from './modules/catalogs/cargos/routes'
import { conceptsRoutes } from './modules/catalogs/concepts/routes'
import { departamentosRoutes } from './modules/catalogs/departamentos/routes'
import { funcionesRoutes } from './modules/catalogs/funciones/routes'
import { dashboardRoutes } from './modules/dashboard/routes'
import { loansRoutes } from './modules/employees/loans/routes'
import { employeeRoutes } from './modules/employees/routes'
import { payrollRoutes } from './modules/payroll/routes'

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
  .use(companyRoutes)
  .use(employeeRoutes)
  .use(cargosRoutes)
  .use(funcionesRoutes)
  .use(departamentosRoutes)
  .use(conceptsRoutes)
  .use(dashboardRoutes)
  .use(acumuladosRoutes)
  .use(loansRoutes)
  .use(creditorRoutes)
  .use(payrollRoutes)

  // ── Start ───────────────────────────────────────────────────────────────────
  .listen(env.PORT)

console.log(`API running at http://localhost:${app.server?.port}`)

export type App = typeof app
