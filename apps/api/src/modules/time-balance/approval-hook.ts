import { hoursToMinutes } from '@payroll/core'
import { sql } from 'drizzle-orm'
import { creditBalance, debitBalance } from './service'

// biome-ignore lint/suspicious/noExplicitAny: Drizzle db instance
type AnyDb = any

const DEBIT_TYPE_CODES = new Set(['ausencias', 'tardanzas', 'permisos'])
const CREDIT_TYPE_CODES = new Set(['horas_extra'])

/**
 * Apply a time-balance movement when an employee_file incidence is approved.
 *
 * NOTE: this runs AFTER approval, so it records the movement with
 * `allowNegative: true` — the balance check that may reject a request belongs
 * BEFORE approval (in the incidences module, future prompt). Best-effort.
 */
export async function applyTimeBalanceOnApproval(db: AnyDb, fileId: string, approverId: string) {
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

    if (DEBIT_TYPE_CODES.has(typeCode)) {
      let minutes = 0
      if (typeCode === 'ausencias') {
        minutes = hoursToMinutes(Number(extra.hours) || 8)
      } else if (typeCode === 'tardanzas') {
        minutes = Math.round(Number(extra.minutes_late) || 0)
      } else if (typeCode === 'permisos') {
        minutes = hoursToMinutes(8)
      }
      if (minutes > 0) {
        await debitBalance(db, row.employee_id, 'compensatory', minutes, {
          allowNegative: true,
          sourceType: `${typeCode}_incidence`,
          sourceId: fileId,
          description: `Aprobación ${typeCode}/${row.subtype_code}`,
          performedBy: approverId,
        })
      }
    } else if (CREDIT_TYPE_CODES.has(typeCode)) {
      const minutes = hoursToMinutes(Number(extra.hours_worked) || 0)
      if (minutes > 0) {
        await creditBalance(db, row.employee_id, 'compensatory', minutes, {
          sourceType: 'overtime_incidence',
          sourceId: fileId,
          description: `Horas extra aprobadas (${row.subtype_code})`,
          performedBy: approverId,
        })
      }
    }
  } catch (_) {
    /* non-blocking */
  }
}
