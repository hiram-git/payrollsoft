import { cors } from '@elysiajs/cors'
import { Elysia } from 'elysia'
import { env } from './config/env'
import { isAllowedOrigin } from './config/origins'
import { csrfPlugin } from './middleware/csrf'
import { globalRateLimit } from './middleware/rateLimit'
import { tenantPlugin } from './middleware/tenant'
import { acumuladosRoutes } from './modules/acumulados/routes'
import { approvalDelegationRoutes } from './modules/approvals/delegation-routes'
import { consolidationRoutes } from './modules/attendance/consolidation-routes'
import { attendanceDevicesRoutes } from './modules/attendance/devices-routes'
import { attendanceImportRoutes } from './modules/attendance/import-routes'
import { justificationRoutes } from './modules/attendance/justification-routes'
import { punchRoutes } from './modules/attendance/punch-routes'
import { attendanceRoutes } from './modules/attendance/routes'
import { syncRoutes } from './modules/attendance/sync-routes'
import { bootstrapWorkers } from './modules/attendance/sync-worker'
import { unifiedPunchRoutes } from './modules/attendance/unified-routes'
import { auditRoutes } from './modules/audit/routes'
import { authRoutes } from './modules/auth/routes'
import { calendarRoutes } from './modules/calendar/routes'
import { budgetItemsRoutes } from './modules/catalogs/budget-items/routes'
import { chartOfAccountsRoutes } from './modules/catalogs/chart-of-accounts/routes'
import { conceptsRoutes } from './modules/catalogs/concepts/routes'
import { departmentsRoutes } from './modules/catalogs/departments/routes'
import { jobFunctionsRoutes } from './modules/catalogs/job-functions/routes'
import { jobTitlesRoutes } from './modules/catalogs/job-titles/routes'
import { companyRoutes } from './modules/company/routes'
import { creditorRoutes } from './modules/creditors/routes'
import { customFieldsRoutes } from './modules/custom-fields/routes'
import { dashboardRoutes } from './modules/dashboard/routes'
import { employeeFilesRoutes } from './modules/employee-files/routes'
import { dependentsRoutes } from './modules/employees/dependents-routes'
import { loansRoutes } from './modules/employees/loans/routes'
import { employeeRoutes } from './modules/employees/routes'
import { facialRoutes } from './modules/facial/routes'
import { payrollRoutes } from './modules/payroll/routes'
import { portalAuthRoutes } from './modules/portal/auth-routes'
import { portalCredentialsRoutes } from './modules/portal/credentials-routes'
import { portalDataRoutes } from './modules/portal/data-routes'
import { positionsRoutes } from './modules/positions/routes'
import { reportsRoutes } from './modules/reports/routes'
import { roleRoutes, userRoleRoutes } from './modules/roles/routes'
import { superadminRoutes } from './modules/superadmin/routes'
import { timeBalanceRenewalRoutes } from './modules/time-balance/renewal-routes'
import { bootstrapRenewalWorkers } from './modules/time-balance/renewal-worker'
import { timeBalanceRoutes } from './modules/time-balance/routes'
import { treasuryRoutes } from './modules/treasury/routes'
import { tenantUserRoutes } from './modules/users/routes'
import { vacationsRoutes } from './modules/vacations/routes'

const app = new Elysia()
  // ── Global middleware (order matters) ──────────────────────────────────────
  .use(
    cors({
      // Refleja el origin si es de confianza (web, nativo Capacitor o
      // configurado). El móvil añade Authorization/X-Device-Token/X-Client.
      origin: (request) => isAllowedOrigin(request.headers.get('origin')),
      credentials: true,
      allowedHeaders: ['Content-Type', 'X-Tenant', 'Authorization', 'X-Device-Token', 'X-Client'],
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
  .use(dependentsRoutes)
  .use(jobTitlesRoutes)
  .use(jobFunctionsRoutes)
  .use(departmentsRoutes)
  .use(budgetItemsRoutes)
  .use(chartOfAccountsRoutes)
  .use(conceptsRoutes)
  .use(dashboardRoutes)
  .use(acumuladosRoutes)
  .use(auditRoutes)
  .use(attendanceRoutes)
  .use(attendanceDevicesRoutes)
  .use(attendanceImportRoutes)
  .use(consolidationRoutes)
  .use(justificationRoutes)
  .use(unifiedPunchRoutes)
  .use(punchRoutes)
  .use(loansRoutes)
  .use(creditorRoutes)
  .use(customFieldsRoutes)
  .use(employeeFilesRoutes)
  .use(vacationsRoutes)
  .use(timeBalanceRoutes)
  .use(timeBalanceRenewalRoutes)
  .use(approvalDelegationRoutes)
  .use(payrollRoutes)
  .use(reportsRoutes)
  .use(facialRoutes)
  .use(treasuryRoutes)
  .use(portalAuthRoutes)
  .use(portalCredentialsRoutes)
  .use(portalDataRoutes)
  .use(syncRoutes)

  // ── Start ───────────────────────────────────────────────────────────────────
  .listen({ port: env.PORT, hostname: env.HOST })

console.log(`API running at http://${env.HOST}:${app.server?.port}`)
if (env.HOST === 'localhost' || env.HOST === '127.0.0.1') {
  console.warn(
    `⚠️  HOST=${env.HOST}: la API solo es accesible desde esta máquina. Para que un móvil/tablet en la LAN la alcance, usa HOST=0.0.0.0.`
  )
}

bootstrapWorkers(env.DATABASE_URL).catch((err) =>
  console.error('[sync-worker] bootstrap failed:', err instanceof Error ? err.message : err)
)

bootstrapRenewalWorkers(env.DATABASE_URL).catch((err) =>
  console.error(
    '[time-balance-renewal] bootstrap failed:',
    err instanceof Error ? err.message : err
  )
)

export type App = typeof app
