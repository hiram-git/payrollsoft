import { attendanceRecords, employeeFiles, vacationRequests } from '@payroll/db'
import { and, desc, eq, gte, sql } from 'drizzle-orm'
import { Elysia } from 'elysia'
import { jwtPlugin } from '../../middleware/auth'
import { tenantPlugin } from '../../middleware/tenant'
import { getBalance } from '../vacations/service'

// biome-ignore lint/suspicious/noExplicitAny: drizzle generic
type AnyDb = any

type PortalEmployee = {
  employeeId: string
  employeeCode: string
  name: string
  idNumber: string
  departmentId: string | null
  tenantSlug: string
}

const portalAuthDerive = new Elysia({ name: 'portal-auth-derive' })
  .use(jwtPlugin)
  .derive({ as: 'global' }, async ({ jwt, cookie }) => {
    const token = cookie.portal_auth?.value
    if (!token) return { portalEmployee: null as PortalEmployee | null }

    const payload = await jwt.verify(token)
    if (!payload || (payload as Record<string, unknown>).type !== 'employee') {
      return { portalEmployee: null as PortalEmployee | null }
    }

    const p = payload as Record<string, unknown>
    return {
      portalEmployee: {
        employeeId: (p.employeeId as string) ?? '',
        employeeCode: (p.employeeCode as string) ?? '',
        name: (p.name as string) ?? '',
        idNumber: (p.idNumber as string) ?? '',
        departmentId: (p.departmentId as string) ?? null,
        tenantSlug: (p.tenantSlug as string) ?? '',
      } satisfies PortalEmployee,
    }
  })

function guardPortal({
  portalEmployee,
  set,
}: {
  portalEmployee: PortalEmployee | null
  set: { status: number | string }
}) {
  if (!portalEmployee) {
    set.status = 401
    return { success: false, error: 'Unauthorized' }
  }
}

export const portalDataRoutes = new Elysia({ prefix: '/portal/data' })
  .use(portalAuthDerive)
  .use(tenantPlugin)

  .get(
    '/dashboard',
    async ({ db, portalEmployee, set }) => {
      if (!db || !portalEmployee) {
        set.status = 400
        return { success: false, error: 'Context required' }
      }
      const empId = portalEmployee.employeeId

      const [vacationBalance, recentRequests, todayAttendance] = await Promise.all([
        getBalance(db, empId, { performedBy: null }).catch(() => null),

        (db as AnyDb)
          .select({
            id: vacationRequests.id,
            requestNumber: vacationRequests.requestNumber,
            requestType: vacationRequests.requestType,
            startDate: vacationRequests.startDate,
            endDate: vacationRequests.endDate,
            enjoyDays: vacationRequests.enjoyDays,
            paidDays: vacationRequests.paidDays,
            status: vacationRequests.status,
            createdAt: vacationRequests.createdAt,
          })
          .from(vacationRequests)
          .where(eq(vacationRequests.employeeId, empId))
          .orderBy(desc(vacationRequests.createdAt))
          .limit(5),

        (db as AnyDb)
          .select({
            id: attendanceRecords.id,
            date: attendanceRecords.date,
            checkIn: attendanceRecords.checkIn,
            checkOut: attendanceRecords.checkOut,
            workedMinutes: attendanceRecords.workedMinutes,
            lateMinutes: attendanceRecords.lateMinutes,
            status: attendanceRecords.status,
          })
          .from(attendanceRecords)
          .where(
            and(
              eq(attendanceRecords.employeeId, empId),
              gte(attendanceRecords.date, sql`CURRENT_DATE - INTERVAL '7 days'`)
            )
          )
          .orderBy(desc(attendanceRecords.date))
          .limit(7),
      ])

      const recentFiles = await (db as AnyDb)
        .select({
          id: employeeFiles.id,
          documentNumber: employeeFiles.documentNumber,
          documentDate: employeeFiles.documentDate,
          observations: employeeFiles.observations,
          approvalStatus: employeeFiles.approvalStatus,
          createdAt: employeeFiles.createdAt,
        })
        .from(employeeFiles)
        .where(eq(employeeFiles.employeeId, empId))
        .orderBy(desc(employeeFiles.createdAt))
        .limit(5)

      return {
        success: true,
        data: {
          employee: {
            name: portalEmployee.name,
            code: portalEmployee.employeeCode,
          },
          vacationBalance,
          recentVacationRequests: recentRequests,
          recentFiles,
          recentAttendance: todayAttendance,
        },
      }
    },
    { beforeHandle: [guardPortal] }
  )
