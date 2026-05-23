import { groupPunchesByDay, parseBiometricTxt } from '@payroll/core/attendance'
import { employees } from '@payroll/db'
import { eq, sql } from 'drizzle-orm'
/**
 * POST /attendance/import
 *
 * Importa marcaciones desde un archivo TXT de reloj biométrico.
 * Parsea, agrupa por (empleado, día), resuelve employeeCode → UUID,
 * y upsertea en attendance_records con source='import'.
 *
 * Body: multipart/form-data con campo `file` (.txt) y opcionalmente
 * `deviceId` (UUID del dispositivo registrado que generó el archivo).
 */
import { Elysia, t } from 'elysia'
import { authPlugin, guardAuth, guardPermission } from '../../middleware/auth'
import { guardTenantMatchesToken, tenantPlugin } from '../../middleware/tenant'
import { recordDeviceEvent } from './devices-service'
import { upsertAttendanceService } from './service'

// biome-ignore lint/suspicious/noExplicitAny: drizzle generic
type AnyDb = any

async function buildEmployeeMap(db: AnyDb): Promise<Map<string, string>> {
  const rows = await db
    .select({ id: employees.id, code: employees.code })
    .from(employees)
    .where(eq(employees.isActive, true))
  const map = new Map<string, string>()
  for (const r of rows as Array<{ id: string; code: string }>) {
    map.set(r.code.toUpperCase().trim(), r.id)
  }
  return map
}

export const attendanceImportRoutes = new Elysia()
  .use(authPlugin)
  .use(tenantPlugin)

  .post(
    '/attendance/import',
    async ({ db, request, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }

      const form = await request.formData()
      const file = form.get('file')
      if (!file || !(file instanceof File)) {
        set.status = 400
        return { success: false, error: 'Falta el archivo TXT.' }
      }
      if (file.size > 5 * 1024 * 1024) {
        set.status = 400
        return { success: false, error: 'El archivo supera los 5 MB.' }
      }

      const deviceId = form.get('deviceId')?.toString().trim() || null
      const content = await file.text()

      const parsed = parseBiometricTxt(content)
      if (parsed.punches.length === 0 && parsed.errors.length === 0) {
        set.status = 400
        return { success: false, error: 'El archivo está vacío.' }
      }

      const days = groupPunchesByDay(parsed.punches)
      const empMap = await buildEmployeeMap(db)

      const summary = {
        totalLines: parsed.totalLines,
        totalDays: days.length,
        imported: 0,
        skipped: 0,
        failed: 0,
        unknownEmployees: 0,
      }
      const rows: Array<{
        employeeCode: string
        date: string
        status: 'imported' | 'skipped' | 'failed'
        message?: string
      }> = []

      for (const day of days) {
        const employeeId = empMap.get(day.employeeCode.toUpperCase())
        if (!employeeId) {
          summary.unknownEmployees++
          summary.failed++
          rows.push({
            employeeCode: day.employeeCode,
            date: day.date,
            status: 'failed',
            message: `Empleado "${day.employeeCode}" no encontrado.`,
          })
          continue
        }

        try {
          const result = await upsertAttendanceService(db, {
            employeeId,
            date: day.date,
            checkIn: day.checkIn,
            checkOut: day.checkOut,
            lunchStart: day.lunchStart,
            lunchEnd: day.lunchEnd,
            source: 'import',
            rawData: {
              deviceId,
              punchCount: day.punchCount,
              punches: day.rawPunches.map((p) => ({
                time: p.time,
                type: p.punchType,
                line: p.lineNumber,
              })),
            },
          })

          if (result.success) {
            summary.imported++
            rows.push({ employeeCode: day.employeeCode, date: day.date, status: 'imported' })
          } else {
            summary.failed++
            rows.push({
              employeeCode: day.employeeCode,
              date: day.date,
              status: 'failed',
              message: result.message ?? 'Error al guardar.',
            })
          }
        } catch (err) {
          summary.failed++
          rows.push({
            employeeCode: day.employeeCode,
            date: day.date,
            status: 'failed',
            message: err instanceof Error ? err.message : 'Error interno.',
          })
        }
      }

      if (deviceId) {
        try {
          await recordDeviceEvent(
            db,
            deviceId,
            'txt_imported',
            `Importados ${summary.imported} registros de ${file.name}`,
            {
              fileName: file.name,
              fileSize: file.size,
              totalLines: parsed.totalLines,
              imported: summary.imported,
              failed: summary.failed,
            }
          )
        } catch {
          /* best-effort */
        }
      }

      return {
        success: true,
        data: {
          summary,
          parseErrors: parsed.errors.slice(0, 50),
          rows,
        },
      }
    },
    {
      beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('attendance:mark')],
    }
  )
