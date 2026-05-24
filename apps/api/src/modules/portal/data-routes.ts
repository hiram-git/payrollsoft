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
  approveEmployeeFile,
  createWithCorrelative,
  rejectEmployeeFile,
} from '../employee-files/service'
import {
  approveRequest as approveVacation,
  getBalance,
  rejectRequest as rejectVacation,
} from '../vacations/service'
import { notifyRequestApproved, notifyRequestCreated, notifyRequestRejected } from './notifications'

// biome-ignore lint/suspicious/noExplicitAny: drizzle generic
type AnyDb = any

type PortalEmployee = {
  employeeId: string
  employeeCode: string
  name: string
  idNumber: string
  departmentId: string | null
  isApprover: boolean
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
        isApprover: (p.isApprover as boolean) ?? false,
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

function guardApprover({
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
  if (!portalEmployee.isApprover) {
    set.status = 403
    return { success: false, error: 'No tiene permisos de aprobador.' }
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

        const [[typeRow], [subRow]] = await Promise.all([
          (db as AnyDb)
            .select({ name: employeeFileTypes.name })
            .from(employeeFileTypes)
            .where(eq(employeeFileTypes.id, typeId))
            .limit(1),
          (db as AnyDb)
            .select({ name: employeeFileSubtypes.name })
            .from(employeeFileSubtypes)
            .where(eq(employeeFileSubtypes.id, subtypeId))
            .limit(1),
        ])
        notifyRequestCreated(db, portalEmployee.employeeId, {
          employeeName: portalEmployee.name,
          employeeCode: portalEmployee.employeeCode,
          documentNumber: result.data?.documentNumber,
          typeName: typeRow?.name,
          subtypeName: subRow?.name,
        })

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

  // ── Approvals (department-scoped) ─────────────────────────────────────

  .get(
    '/approvals',
    async ({ db, portalEmployee, set }) => {
      if (!db || !portalEmployee) {
        set.status = 400
        return { success: false, error: 'Context required' }
      }
      const deptId = portalEmployee.departmentId

      const [pendingFiles, pendingVacations] = await Promise.all([
        (db as AnyDb).execute(sql`
          SELECT ef.id, ef.document_number, ef.document_date, ef.observations,
                 ef.approval_status, ef.created_at,
                 eft.name AS type_name, efs.name AS subtype_name,
                 e.code AS employee_code,
                 e.first_name AS employee_first_name,
                 e.last_name AS employee_last_name
          FROM employee_files ef
          JOIN employee_file_types    eft ON eft.id = ef.type_id
          JOIN employee_file_subtypes efs ON efs.id = ef.subtype_id
          JOIN employees e ON e.id = ef.employee_id
          WHERE ef.approval_status = 'pending'
            AND e.department_id = ${deptId}
            AND ef.employee_id != ${portalEmployee.employeeId}
          ORDER BY ef.created_at ASC
        `),

        (db as AnyDb).execute(sql`
          SELECT vr.id, vr.request_number, vr.request_type,
                 vr.start_date, vr.end_date, vr.enjoy_days, vr.paid_days,
                 vr.status, vr.reason, vr.created_at,
                 e.code AS employee_code,
                 e.first_name AS employee_first_name,
                 e.last_name AS employee_last_name
          FROM vacation_requests vr
          JOIN employees e ON e.id = vr.employee_id
          WHERE vr.status = 'pending'
            AND e.department_id = ${deptId}
            AND vr.employee_id != ${portalEmployee.employeeId}
          ORDER BY vr.created_at ASC
        `),
      ])

      return {
        success: true,
        data: {
          files: pendingFiles,
          vacations: pendingVacations,
        },
      }
    },
    { beforeHandle: [guardApprover] }
  )

  .post(
    '/approvals/files/:id/approve',
    async ({ db, portalEmployee, params, set }) => {
      if (!db || !portalEmployee) {
        set.status = 400
        return { success: false, error: 'Context required' }
      }
      const result = await approveEmployeeFile(db, params.id, portalEmployee.employeeId)
      if (!result.success) {
        set.status = 422
        return result
      }
      const [fileInfo] = await (db as AnyDb).execute(sql`
        SELECT ef.employee_id, ef.document_number, e.first_name, e.last_name, e.code,
               eft.name AS type_name, efs.name AS subtype_name
        FROM employee_files ef
        JOIN employees e ON e.id = ef.employee_id
        JOIN employee_file_types eft ON eft.id = ef.type_id
        JOIN employee_file_subtypes efs ON efs.id = ef.subtype_id
        WHERE ef.id = ${params.id} LIMIT 1
      `)
      if (fileInfo) {
        notifyRequestApproved(db, fileInfo.employee_id, {
          employeeName: `${fileInfo.first_name} ${fileInfo.last_name}`,
          employeeCode: fileInfo.code,
          documentNumber: fileInfo.document_number,
          typeName: fileInfo.type_name,
          subtypeName: fileInfo.subtype_name,
        })
      }
      return result
    },
    {
      beforeHandle: [guardApprover],
      params: t.Object({ id: t.String() }),
    }
  )

  .post(
    '/approvals/files/:id/reject',
    async ({ db, portalEmployee, params, body, set }) => {
      if (!db || !portalEmployee) {
        set.status = 400
        return { success: false, error: 'Context required' }
      }
      const result = await rejectEmployeeFile(db, params.id, portalEmployee.employeeId, body.reason)
      if (!result.success) {
        set.status = 422
        return result
      }
      const [fileInfo] = await (db as AnyDb).execute(sql`
        SELECT ef.employee_id, ef.document_number, e.first_name, e.last_name, e.code,
               eft.name AS type_name, efs.name AS subtype_name
        FROM employee_files ef
        JOIN employees e ON e.id = ef.employee_id
        JOIN employee_file_types eft ON eft.id = ef.type_id
        JOIN employee_file_subtypes efs ON efs.id = ef.subtype_id
        WHERE ef.id = ${params.id} LIMIT 1
      `)
      if (fileInfo) {
        notifyRequestRejected(db, fileInfo.employee_id, {
          employeeName: `${fileInfo.first_name} ${fileInfo.last_name}`,
          employeeCode: fileInfo.code,
          documentNumber: fileInfo.document_number,
          typeName: fileInfo.type_name,
          subtypeName: fileInfo.subtype_name,
          reason: body.reason,
        })
      }
      return result
    },
    {
      beforeHandle: [guardApprover],
      params: t.Object({ id: t.String() }),
      body: t.Object({ reason: t.String() }),
    }
  )

  .post(
    '/approvals/vacations/:id/approve',
    async ({ db, portalEmployee, params, set }) => {
      if (!db || !portalEmployee) {
        set.status = 400
        return { success: false, error: 'Context required' }
      }
      const result = await approveVacation(db, params.id, portalEmployee.employeeId)
      if (!result.success) {
        set.status = 422
        return result
      }
      const [vacInfo] = await (db as AnyDb).execute(sql`
        SELECT vr.employee_id, vr.request_number, e.first_name, e.last_name, e.code
        FROM vacation_requests vr JOIN employees e ON e.id = vr.employee_id
        WHERE vr.id = ${params.id} LIMIT 1
      `)
      if (vacInfo) {
        notifyRequestApproved(db, vacInfo.employee_id, {
          employeeName: `${vacInfo.first_name} ${vacInfo.last_name}`,
          employeeCode: vacInfo.code,
          documentNumber: vacInfo.request_number,
          typeName: 'Vacaciones',
        })
      }
      return result
    },
    {
      beforeHandle: [guardApprover],
      params: t.Object({ id: t.String() }),
    }
  )

  .post(
    '/approvals/vacations/:id/reject',
    async ({ db, portalEmployee, params, body, set }) => {
      if (!db || !portalEmployee) {
        set.status = 400
        return { success: false, error: 'Context required' }
      }
      const result = await rejectVacation(db, params.id, portalEmployee.employeeId, body.reason)
      if (!result.success) {
        set.status = 422
        return result
      }
      const [vacInfo] = await (db as AnyDb).execute(sql`
        SELECT vr.employee_id, vr.request_number, e.first_name, e.last_name, e.code
        FROM vacation_requests vr JOIN employees e ON e.id = vr.employee_id
        WHERE vr.id = ${params.id} LIMIT 1
      `)
      if (vacInfo) {
        notifyRequestRejected(db, vacInfo.employee_id, {
          employeeName: `${vacInfo.first_name} ${vacInfo.last_name}`,
          employeeCode: vacInfo.code,
          documentNumber: vacInfo.request_number,
          typeName: 'Vacaciones',
          reason: body.reason,
        })
      }
      return result
    },
    {
      beforeHandle: [guardApprover],
      params: t.Object({ id: t.String() }),
      body: t.Object({ reason: t.String() }),
    }
  )

  .get(
    '/attendance',
    async ({ db, portalEmployee, query, set }) => {
      if (!db || !portalEmployee) {
        set.status = 400
        return { success: false, error: 'Context required' }
      }
      const empId = portalEmployee.employeeId
      const dateFrom = query.from ?? ''
      const dateTo = query.to ?? ''

      let dateFilter = sql`ar.date >= CURRENT_DATE - INTERVAL '30 days'`
      if (dateFrom && dateTo) {
        dateFilter = sql`ar.date >= ${dateFrom} AND ar.date <= ${dateTo}`
      } else if (dateFrom) {
        dateFilter = sql`ar.date >= ${dateFrom}`
      } else if (dateTo) {
        dateFilter = sql`ar.date <= ${dateTo}`
      }

      const rows = await (db as AnyDb).execute(sql`
        SELECT ar.id, ar.date, ar.check_in, ar.check_out,
               ar.worked_minutes, ar.late_minutes, ar.overtime_minutes,
               ar.status, ar.source
        FROM attendance_records ar
        WHERE ar.employee_id = ${empId} AND ${dateFilter}
        ORDER BY ar.date DESC
        LIMIT 200
      `)
      return { success: true, data: rows }
    },
    {
      beforeHandle: [guardPortal],
      query: t.Object({ from: t.Optional(t.String()), to: t.Optional(t.String()) }),
    }
  )
