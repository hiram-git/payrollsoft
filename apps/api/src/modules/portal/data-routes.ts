import {
  attendanceRecords,
  employeeFileSubtypes,
  employeeFileTypes,
  employeeFiles,
  vacationRequests,
} from '@payroll/db'
import { and, asc, desc, eq, gte, sql } from 'drizzle-orm'
import { Elysia, t } from 'elysia'
import { jwtPlugin } from '../../middleware/auth'
import { tenantPlugin } from '../../middleware/tenant'
import { getFieldsFor } from '../employee-files/dynamic-fields'
import {
  type EmployeeFileInput,
  type FormFile,
  createWithCorrelative,
} from '../employee-files/service'
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

  .get(
    '/file-types',
    async ({ db, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const data = await (db as AnyDb)
        .select({
          id: employeeFileTypes.id,
          code: employeeFileTypes.code,
          name: employeeFileTypes.name,
        })
        .from(employeeFileTypes)
        .where(eq(employeeFileTypes.isActive, 1))
        .orderBy(asc(employeeFileTypes.sortOrder), asc(employeeFileTypes.name))
      return { success: true, data }
    },
    { beforeHandle: [guardPortal] }
  )

  .get(
    '/file-types/:typeId/subtypes',
    async ({ db, params, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const typeId = Number.parseInt(params.typeId, 10)
      if (!Number.isFinite(typeId)) {
        set.status = 400
        return { success: false, error: 'Invalid typeId' }
      }
      const data = await (db as AnyDb)
        .select({
          id: employeeFileSubtypes.id,
          code: employeeFileSubtypes.code,
          name: employeeFileSubtypes.name,
        })
        .from(employeeFileSubtypes)
        .where(and(eq(employeeFileSubtypes.typeId, typeId), eq(employeeFileSubtypes.isActive, 1)))
        .orderBy(asc(employeeFileSubtypes.sortOrder), asc(employeeFileSubtypes.name))
      return { success: true, data }
    },
    {
      beforeHandle: [guardPortal],
      params: t.Object({ typeId: t.String() }),
    }
  )

  .get(
    '/file-fields',
    async ({ db, query, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const typeId = Number.parseInt(query.typeId ?? '', 10)
      const subtypeId = Number.parseInt(query.subtypeId ?? '', 10)
      if (!Number.isFinite(typeId) || !Number.isFinite(subtypeId)) {
        return { success: true, data: { fields: [] } }
      }
      const [typeRow] = await (db as AnyDb)
        .select({ code: employeeFileTypes.code })
        .from(employeeFileTypes)
        .where(eq(employeeFileTypes.id, typeId))
        .limit(1)
      const [subRow] = await (db as AnyDb)
        .select({ code: employeeFileSubtypes.code })
        .from(employeeFileSubtypes)
        .where(eq(employeeFileSubtypes.id, subtypeId))
        .limit(1)
      const fields = getFieldsFor(typeRow?.code ?? '', subRow?.code ?? null)
      return { success: true, data: { fields } }
    },
    {
      beforeHandle: [guardPortal],
      query: t.Object({
        typeId: t.Optional(t.String()),
        subtypeId: t.Optional(t.String()),
      }),
    }
  )

  .post(
    '/requests',
    async ({ db, portalEmployee, request, tenantSlug, set }) => {
      if (!db || !portalEmployee || !tenantSlug) {
        set.status = 400
        return { success: false, error: 'Context required' }
      }

      const form = await request.formData()
      const scalars: Record<string, string> = {}
      const extraFields: Record<string, unknown> = {}
      const files: FormFile[] = []

      for (const [key, value] of form.entries()) {
        if (value instanceof File) {
          if (value.size === 0 || !value.name) continue
          const bytes = new Uint8Array(await value.arrayBuffer())
          if (key === 'attachments') {
            files.push({
              label: 'adjunto',
              originalName: value.name,
              mimeType: value.type || 'application/octet-stream',
              bytes,
            })
          } else if (key.startsWith('file_')) {
            files.push({
              label: key.slice('file_'.length),
              originalName: value.name,
              mimeType: value.type || 'application/octet-stream',
              bytes,
            })
          }
          continue
        }
        if (key.startsWith('extra_')) {
          extraFields[key.slice('extra_'.length)] = value
        } else {
          scalars[key] = value
        }
      }

      const typeId = Number.parseInt(scalars.typeId ?? '', 10)
      const subtypeId = Number.parseInt(scalars.subtypeId ?? '', 10)
      if (!Number.isFinite(typeId) || !Number.isFinite(subtypeId) || !scalars.documentDate) {
        set.status = 400
        return { success: false, error: 'typeId, subtypeId y documentDate son obligatorios.' }
      }

      const input: EmployeeFileInput = {
        employeeId: portalEmployee.employeeId,
        typeId,
        subtypeId,
        documentDate: scalars.documentDate.trim(),
        observations: scalars.observations ?? null,
        extraFields,
      }

      try {
        const result = await createWithCorrelative(db, tenantSlug, input, files, {
          createdBy: portalEmployee.employeeId,
        })
        if (!result.success) {
          set.status = 422
          return { success: false, error: result.message }
        }
        set.status = 201
        return { success: true, data: result.data }
      } catch (err) {
        set.status = 500
        return {
          success: false,
          error: err instanceof Error ? err.message : 'Error al crear la solicitud.',
        }
      }
    },
    { beforeHandle: [guardPortal] }
  )

  .get(
    '/requests',
    async ({ db, portalEmployee, set }) => {
      if (!db || !portalEmployee) {
        set.status = 400
        return { success: false, error: 'Context required' }
      }

      const rows = await (db as AnyDb).execute(sql`
        SELECT ef.id, ef.document_number, ef.document_date, ef.observations,
               ef.approval_status, ef.rejection_reason, ef.created_at,
               eft.name  AS type_name,
               efs.name  AS subtype_name
        FROM employee_files ef
        JOIN employee_file_types    eft ON eft.id = ef.type_id
        JOIN employee_file_subtypes efs ON efs.id = ef.subtype_id
        WHERE ef.employee_id = ${portalEmployee.employeeId}
        ORDER BY ef.created_at DESC
        LIMIT 100
      `)
      return { success: true, data: rows }
    },
    { beforeHandle: [guardPortal] }
  )

  .get(
    '/requests/:id',
    async ({ db, portalEmployee, params, set }) => {
      if (!db || !portalEmployee) {
        set.status = 400
        return { success: false, error: 'Context required' }
      }
      const rows = await (db as AnyDb).execute(sql`
        SELECT ef.*, eft.name AS type_name, efs.name AS subtype_name
        FROM employee_files ef
        JOIN employee_file_types    eft ON eft.id = ef.type_id
        JOIN employee_file_subtypes efs ON efs.id = ef.subtype_id
        WHERE ef.id = ${params.id} AND ef.employee_id = ${portalEmployee.employeeId}
        LIMIT 1
      `)
      if (!rows.length) {
        set.status = 404
        return { success: false, error: 'Solicitud no encontrada.' }
      }
      return { success: true, data: rows[0] }
    },
    {
      beforeHandle: [guardPortal],
      params: t.Object({ id: t.String() }),
    }
  )
