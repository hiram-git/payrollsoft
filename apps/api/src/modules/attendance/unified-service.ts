/**
 * Service for the unified punch timeline.
 *
 * Merges punches from both `attendance_punches` (TXT/manual/API)
 * and `facial_punches` (facial recognition) into a single sorted
 * list. Falls back gracefully if the facial tables don't exist
 * (pgvector not installed).
 */
import { attendancePunches, employees } from '@payroll/db'
import { and, desc, eq, gte, lte, sql } from 'drizzle-orm'

// biome-ignore lint/suspicious/noExplicitAny: drizzle generic
type AnyDb = any

export type UnifiedPunch = {
  id: string
  employeeId: string
  employeeCode: string | null
  employeeName: string | null
  punchedAt: string
  punchType: number
  source: string
  deviceId: string | null
  idempotencyKey: string | null
}

export async function listUnifiedPunches(
  db: AnyDb,
  filters: {
    date?: string
    from?: string
    to?: string
    employeeId?: string
    source?: string
  },
  limit = 200
): Promise<UnifiedPunch[]> {
  const results: UnifiedPunch[] = []

  // ── 1. attendance_punches (always available) ─────────────────────────
  const conditions: ReturnType<typeof eq>[] = []
  if (filters.employeeId) {
    conditions.push(eq(attendancePunches.employeeId, filters.employeeId))
  }
  if (filters.date) {
    conditions.push(gte(attendancePunches.punchedAt, new Date(`${filters.date}T00:00:00`)))
    conditions.push(lte(attendancePunches.punchedAt, new Date(`${filters.date}T23:59:59.999`)))
  } else {
    if (filters.from) {
      conditions.push(gte(attendancePunches.punchedAt, new Date(`${filters.from}T00:00:00`)))
    }
    if (filters.to) {
      conditions.push(lte(attendancePunches.punchedAt, new Date(`${filters.to}T23:59:59.999`)))
    }
  }
  if (filters.source && filters.source !== 'facial') {
    conditions.push(eq(attendancePunches.source, filters.source))
  }

  if (!filters.source || filters.source !== 'facial') {
    const rows = await db
      .select({
        id: attendancePunches.id,
        employeeId: attendancePunches.employeeId,
        employeeCode: employees.code,
        employeeName: sql<string>`${employees.firstName} || ' ' || ${employees.lastName}`,
        punchedAt: attendancePunches.punchedAt,
        punchType: attendancePunches.punchType,
        source: attendancePunches.source,
        deviceId: attendancePunches.deviceId,
        idempotencyKey: attendancePunches.idempotencyKey,
      })
      .from(attendancePunches)
      .leftJoin(employees, eq(employees.id, attendancePunches.employeeId))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(attendancePunches.punchedAt))
      .limit(limit)

    for (const r of rows as Array<Record<string, unknown>>) {
      results.push({
        id: String(r.id),
        employeeId: String(r.employeeId),
        employeeCode: r.employeeCode ? String(r.employeeCode) : null,
        employeeName: r.employeeName ? String(r.employeeName) : null,
        punchedAt: r.punchedAt instanceof Date ? r.punchedAt.toISOString() : String(r.punchedAt),
        punchType: Number(r.punchType ?? 0),
        source: String(r.source ?? 'unknown'),
        deviceId: r.deviceId ? String(r.deviceId) : null,
        idempotencyKey: r.idempotencyKey ? String(r.idempotencyKey) : null,
      })
    }
  }

  // ── 2. facial_punches (only if table exists — pgvector optional) ────
  if (!filters.source || filters.source === 'facial' || filters.source === '') {
    try {
      const facialConditions: string[] = []
      const params: unknown[] = []
      let paramIdx = 1

      if (filters.employeeId) {
        facialConditions.push(`fp.employee_id = $${paramIdx}::uuid`)
        params.push(filters.employeeId)
        paramIdx++
      }
      if (filters.date) {
        facialConditions.push(`fp.captured_at >= $${paramIdx}::timestamptz`)
        params.push(`${filters.date}T00:00:00`)
        paramIdx++
        facialConditions.push(`fp.captured_at <= $${paramIdx}::timestamptz`)
        params.push(`${filters.date}T23:59:59.999`)
        paramIdx++
      } else {
        if (filters.from) {
          facialConditions.push(`fp.captured_at >= $${paramIdx}::timestamptz`)
          params.push(`${filters.from}T00:00:00`)
          paramIdx++
        }
        if (filters.to) {
          facialConditions.push(`fp.captured_at <= $${paramIdx}::timestamptz`)
          params.push(`${filters.to}T23:59:59.999`)
          paramIdx++
        }
      }

      const whereClause =
        facialConditions.length > 0 ? `WHERE ${facialConditions.join(' AND ')}` : ''

      const facialRows = await db.execute(
        sql.raw(`
        SELECT
          fp.id::text,
          fp.employee_id,
          e.code AS employee_code,
          e.first_name || ' ' || e.last_name AS employee_name,
          fp.captured_at AS punched_at,
          CASE fp.kind
            WHEN 'entry' THEN 0
            WHEN 'lunch_start' THEN 1
            WHEN 'lunch_end' THEN 2
            WHEN 'exit' THEN 3
            ELSE 9
          END AS punch_type,
          'facial' AS source,
          fp.terminal_id AS device_id,
          fp.idempotency_key
        FROM facial_punches fp
        LEFT JOIN employees e ON e.id = fp.employee_id
        ${whereClause}
        ORDER BY fp.captured_at DESC
        LIMIT ${limit}
      `)
      )

      for (const r of facialRows as Array<Record<string, unknown>>) {
        results.push({
          id: `f-${r.id}`,
          employeeId: String(r.employee_id),
          employeeCode: r.employee_code ? String(r.employee_code) : null,
          employeeName: r.employee_name ? String(r.employee_name) : null,
          punchedAt:
            r.punched_at instanceof Date ? r.punched_at.toISOString() : String(r.punched_at),
          punchType: Number(r.punch_type ?? 9),
          source: 'facial',
          deviceId: r.device_id ? String(r.device_id) : null,
          idempotencyKey: r.idempotency_key ? String(r.idempotency_key) : null,
        })
      }
    } catch {
      // facial_punches table doesn't exist (pgvector not installed) — skip silently
    }
  }

  // Sort merged results by punchedAt descending
  results.sort((a, b) => b.punchedAt.localeCompare(a.punchedAt))
  return results.slice(0, limit)
}
