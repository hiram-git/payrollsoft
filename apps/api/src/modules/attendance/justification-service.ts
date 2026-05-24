/**
 * Service for attendance justifications.
 *
 * Handles creating justification requests, approving/rejecting them,
 * and updating the attendance_records status to 'justified' on approval.
 */
import { attendanceJustifications, attendanceRecords } from '@payroll/db'
import { desc, eq } from 'drizzle-orm'

// biome-ignore lint/suspicious/noExplicitAny: drizzle generic
type AnyDb = any

export async function createJustification(
  db: AnyDb,
  input: {
    attendanceId: string
    employeeId: string
    employeeFileId?: string | null
    reason?: string | null
  }
): Promise<{ id: string }> {
  const [row] = await db
    .insert(attendanceJustifications)
    .values({
      attendanceId: input.attendanceId,
      employeeId: input.employeeId,
      employeeFileId: input.employeeFileId ?? null,
      reason: input.reason?.trim() ?? null,
    })
    .returning({ id: attendanceJustifications.id })
  return { id: row.id as string }
}

export async function approveJustification(
  db: AnyDb,
  id: string,
  reviewerId: string,
  notes?: string
): Promise<{ success: true } | { success: false; error: string }> {
  const [just] = await db
    .select()
    .from(attendanceJustifications)
    .where(eq(attendanceJustifications.id, id))
    .limit(1)
  if (!just) return { success: false, error: 'Justificación no encontrada.' }
  if (just.status !== 'pending') {
    return { success: false, error: `La justificación ya está ${just.status}.` }
  }

  await db
    .update(attendanceJustifications)
    .set({
      status: 'approved',
      reviewedBy: reviewerId,
      reviewedAt: new Date(),
      reviewNotes: notes?.trim() ?? null,
    })
    .where(eq(attendanceJustifications.id, id))

  await db
    .update(attendanceRecords)
    .set({ status: 'justified' })
    .where(eq(attendanceRecords.id, just.attendanceId))

  return { success: true }
}

export async function rejectJustification(
  db: AnyDb,
  id: string,
  reviewerId: string,
  notes?: string
): Promise<{ success: true } | { success: false; error: string }> {
  const [just] = await db
    .select()
    .from(attendanceJustifications)
    .where(eq(attendanceJustifications.id, id))
    .limit(1)
  if (!just) return { success: false, error: 'Justificación no encontrada.' }
  if (just.status !== 'pending') {
    return { success: false, error: `La justificación ya está ${just.status}.` }
  }

  await db
    .update(attendanceJustifications)
    .set({
      status: 'rejected',
      reviewedBy: reviewerId,
      reviewedAt: new Date(),
      reviewNotes: notes?.trim() ?? null,
    })
    .where(eq(attendanceJustifications.id, id))

  return { success: true }
}

export async function listJustifications(
  db: AnyDb,
  filters: { employeeId?: string; status?: string } = {}
) {
  const conditions = []
  if (filters.employeeId) {
    conditions.push(eq(attendanceJustifications.employeeId, filters.employeeId))
  }
  if (filters.status) {
    conditions.push(eq(attendanceJustifications.status, filters.status))
  }

  return db
    .select()
    .from(attendanceJustifications)
    .where(conditions.length > 0 ? conditions.reduce((a, b) => a) : undefined)
    .orderBy(desc(attendanceJustifications.submittedAt))
}

export async function listPendingJustifications(db: AnyDb) {
  return db.execute(
    // biome-ignore lint/style/noUnusedTemplateLiteral: sql tagged template
    `SELECT j.*,
            e.code AS employee_code,
            e.first_name AS employee_first_name,
            e.last_name AS employee_last_name,
            ar.date AS attendance_date,
            ar.status AS attendance_status
     FROM attendance_justifications j
     JOIN employees e ON e.id = j.employee_id
     JOIN attendance_records ar ON ar.id = j.attendance_id
     WHERE j.status = 'pending'
     ORDER BY j.submitted_at ASC`
  )
}
