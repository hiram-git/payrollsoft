/**
 * POST /attendance/import
 *
 * Importa marcaciones desde un archivo TXT de reloj biométrico.
 *
 * Flujo optimizado para alto volumen (1000+ empleados, sync cada 5 min):
 *
 *   1. Parsea TXT → punches individuales
 *   2. INSERT cada punch en `attendance_punches` con idempotency_key
 *      → ON CONFLICT DO NOTHING (skip duplicados en re-imports)
 *   3. Agrupa los punches NUEVOS por (empleado, día)
 *   4. Consolida → UPSERT en `attendance_records` (resumen diario)
 *
 * NO escribe rawData JSONB en attendance_records — los punches
 * individuales viven en su propia tabla y son purgables después
 * de N días sin perder el resumen.
 */
import { groupPunchesByDay, parseBiometricTxt } from '@payroll/core/attendance'
import { attendancePunches, employees } from '@payroll/db'
import { eq, sql } from 'drizzle-orm'
import { Elysia } from 'elysia'
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
      const deviceCode = form.get('deviceCode')?.toString().trim() || 'UNKNOWN'
      const content = await file.text()

      const parsed = parseBiometricTxt(content)
      if (parsed.punches.length === 0 && parsed.errors.length === 0) {
        set.status = 400
        return { success: false, error: 'El archivo está vacío.' }
      }

      const empMap = await buildEmployeeMap(db)

      // ── Paso 1: INSERT punches individuales con idempotency key ────────
      let punchesInserted = 0
      let punchesSkipped = 0
      const unknownCodes = new Set<string>()
      const affectedPairs = new Set<string>()

      for (const p of parsed.punches) {
        const employeeId = empMap.get(p.employeeCode.toUpperCase())
        if (!employeeId) {
          unknownCodes.add(p.employeeCode)
          continue
        }

        const idemKey = `${p.deviceCode ?? deviceCode}:${p.employeeCode}:${p.date}_${p.time.replace(/:/g, '')}`
        const punchedAt = new Date(`${p.date}T${p.time.length === 5 ? `${p.time}:00` : p.time}`)

        try {
          const result = await db
            .insert(attendancePunches)
            .values({
              employeeId,
              deviceId,
              punchedAt,
              punchType: p.punchType,
              source: 'import',
              idempotencyKey: idemKey,
            })
            .onConflictDoNothing()
            .returning({ id: attendancePunches.id })

          if (result.length > 0) {
            punchesInserted++
            affectedPairs.add(`${p.employeeCode}|${p.date}`)
          } else {
            punchesSkipped++
          }
        } catch {
          punchesSkipped++
        }
      }

      // ── Paso 2: Consolidar solo los (empleado, día) que tuvieron nuevos punches ─
      const days = groupPunchesByDay(
        parsed.punches.filter((p) => {
          const key = `${p.employeeCode}|${p.date}`
          return affectedPairs.has(key)
        })
      )

      let consolidated = 0
      let consolidateErrors = 0
      const rows: Array<{
        employeeCode: string
        date: string
        status: 'imported' | 'skipped' | 'failed'
        message?: string
      }> = []

      for (const day of days) {
        const employeeId = empMap.get(day.employeeCode.toUpperCase())
        if (!employeeId) continue

        try {
          const result = await upsertAttendanceService(db, {
            employeeId,
            date: day.date,
            checkIn: day.checkIn,
            checkOut: day.checkOut,
            lunchStart: day.lunchStart,
            lunchEnd: day.lunchEnd,
            source: 'import',
          })

          if (result.success) {
            consolidated++
            rows.push({ employeeCode: day.employeeCode, date: day.date, status: 'imported' })
          } else {
            consolidateErrors++
            rows.push({
              employeeCode: day.employeeCode,
              date: day.date,
              status: 'failed',
              message: result.message ?? 'Error al consolidar.',
            })
          }
        } catch (err) {
          consolidateErrors++
          rows.push({
            employeeCode: day.employeeCode,
            date: day.date,
            status: 'failed',
            message: err instanceof Error ? err.message : 'Error interno.',
          })
        }
      }

      for (const code of unknownCodes) {
        rows.push({
          employeeCode: code,
          date: '—',
          status: 'failed',
          message: `Empleado "${code}" no encontrado.`,
        })
      }

      if (deviceId) {
        try {
          await recordDeviceEvent(
            db,
            deviceId,
            'txt_imported',
            `${punchesInserted} punches nuevos, ${punchesSkipped} duplicados, ${consolidated} jornadas consolidadas`,
            {
              fileName: file.name,
              fileSize: file.size,
              punchesInserted,
              punchesSkipped,
              consolidated,
            }
          )
        } catch {
          /* best-effort */
        }
      }

      return {
        success: true,
        data: {
          summary: {
            totalLines: parsed.totalLines,
            punchesInserted,
            punchesSkipped,
            daysConsolidated: consolidated,
            consolidateErrors,
            unknownEmployees: unknownCodes.size,
          },
          parseErrors: parsed.errors.slice(0, 50),
          rows,
        },
      }
    },
    {
      beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('attendance:mark')],
    }
  )

  // ── Purgar punches antiguos ──────────────────────────────────────────────
  // Borra punches de más de N días (default 90). Los resúmenes en
  // attendance_records quedan intactos — son la fuente canónica.
  .post(
    '/attendance/punches/purge',
    async ({ db, request, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const body = (await request.json().catch(() => ({}))) as { olderThanDays?: number }
      const days = Math.max(body.olderThanDays ?? 90, 7)

      const result = await db.execute(sql`
        DELETE FROM attendance_punches
        WHERE created_at < NOW() - INTERVAL '1 day' * ${days}
      `)
      const deleted = (result as Array<{ count?: number }>)[0]?.count ?? 0
      return { success: true, data: { deleted, olderThanDays: days } }
    },
    {
      beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('attendance:edit')],
    }
  )
