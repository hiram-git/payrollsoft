import { sql } from 'drizzle-orm'
import { addHours, deductHours } from './service'

// biome-ignore lint/suspicious/noExplicitAny: Drizzle db instance
type AnyDb = any

const DEDUCT_TYPE_CODES = new Set(['ausencias', 'tardanzas', 'permisos'])

const ADD_TYPE_CODES = new Set(['horas_extra'])

export async function applyCompensatoryTimeOnApproval(
  db: AnyDb,
  fileId: string,
  approverId: string
) {
  try {
    const [row] = await db.execute(sql`
      SELECT ef.employee_id, ef.extra_fields,
             eft.code AS type_code, efs.code AS subtype_code
      FROM employee_files ef
      JOIN employee_file_types eft ON eft.id = ef.type_id
      JOIN employee_file_subtypes efs ON efs.id = ef.subtype_id
      WHERE ef.id = ${fileId} LIMIT 1
    `)
    if (!row) return

    const typeCode: string = row.type_code
    const extra = (row.extra_fields ?? {}) as Record<string, unknown>

    if (DEDUCT_TYPE_CODES.has(typeCode)) {
      let hours = 0
      if (typeCode === 'ausencias') {
        hours = Number(extra.hours) || 8
      } else if (typeCode === 'tardanzas') {
        hours = (Number(extra.minutes_late) || 0) / 60
      } else if (typeCode === 'permisos') {
        hours = 8
      }

      if (hours > 0) {
        await deductHours(db, row.employee_id, 'compensatory', hours, typeCode, {
          referenceType: 'employee_file',
          referenceId: fileId,
          notes: `Aprobación ${typeCode}/${row.subtype_code}`,
          performedBy: approverId,
        })
      }
    } else if (ADD_TYPE_CODES.has(typeCode)) {
      const hours = Number(extra.hours_worked) || 0
      if (hours > 0) {
        await addHours(db, row.employee_id, 'compensatory', hours, 'overtime', {
          referenceType: 'employee_file',
          referenceId: fileId,
          notes: `Horas extra aprobadas (${row.subtype_code})`,
          performedBy: approverId,
        })
      }
    }
  } catch (_) {
    /* non-blocking */
  }
}
