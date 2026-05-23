import { cors } from '@elysiajs/cors'
import { Elysia } from 'elysia'
import { env } from './config/env'
import { csrfPlugin } from './middleware/csrf'
import { globalRateLimit } from './middleware/rateLimit'
import { tenantPlugin } from './middleware/tenant'
import { acumuladosRoutes } from './modules/acumulados/routes'
import { attendanceDevicesRoutes } from './modules/attendance/devices-routes'
import { attendanceImportRoutes } from './modules/attendance/import-routes'
import { attendanceRoutes } from './modules/attendance/routes'
import { authRoutes } from './modules/auth/routes'
import { calendarRoutes } from './modules/calendar/routes'
import { cargosRoutes } from './modules/catalogs/cargos/routes'
import { conceptsRoutes } from './modules/catalogs/concepts/routes'
import { cuentasContablesRoutes } from './modules/catalogs/cuentas-contables/routes'
import { departamentosRoutes } from './modules/catalogs/departamentos/routes'
import { funcionesRoutes } from './modules/catalogs/funciones/routes'
import { partidasRoutes } from './modules/catalogs/partidas/routes'
import { companyRoutes } from './modules/company/routes'
import { creditorRoutes } from './modules/creditors/routes'
import { customFieldsRoutes } from './modules/custom-fields/routes'
import { dashboardRoutes } from './modules/dashboard/routes'
import { employeeFilesRoutes } from './modules/employee-files/routes'
import { loansRoutes } from './modules/employees/loans/routes'
import { employeeRoutes } from './modules/employees/routes'
import { facialRoutes } from './modules/facial/routes'
import { payrollRoutes } from './modules/payroll/routes'
import { positionsRoutes } from './modules/positions/routes'
import { reportsRoutes } from './modules/reports/routes'
import { roleRoutes, userRoleRoutes } from './modules/roles/routes'
import { superadminRoutes } from './modules/superadmin/routes'
import { treasuryRoutes } from './modules/treasury/routes'
import { tenantUserRoutes } from './modules/users/routes'
import { vacationsRoutes } from './modules/vacations/routes'

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
  .use(superadminRoutes)
  .use(calendarRoutes)
  .use(roleRoutes)
  .use(userRoleRoutes)
  .use(tenantUserRoutes)
  .use(companyRoutes)
  .use(positionsRoutes)
  .use(employeeRoutes)
  .use(cargosRoutes)
  .use(funcionesRoutes)
  .use(departamentosRoutes)
  .use(partidasRoutes)
  .use(cuentasContablesRoutes)
  .use(conceptsRoutes)
  .use(dashboardRoutes)
  .use(acumuladosRoutes)
  .use(attendanceRoutes)
  .use(attendanceDevicesRoutes)
  .use(attendanceImportRoutes)
  .use(loansRoutes)
  .use(creditorRoutes)
  .use(customFieldsRoutes)
  .use(employeeFilesRoutes)
  .use(vacationsRoutes)
  .use(payrollRoutes)
  .use(reportsRoutes)
  .use(facialRoutes)
  .use(treasuryRoutes)

  // ── Start ───────────────────────────────────────────────────────────────────
  .listen({ port: env.PORT, hostname: env.HOST })

console.log(`API running at http://${env.HOST}:${app.server?.port}`)

export type App = typeof app
