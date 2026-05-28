import { index, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'

/**
 * Justificaciones de ausencia/tardanza.
 *
 * Enlaza un registro de asistencia (attendance_records) con una
 * solicitud de justificación. Opcionalmente vincula a un expediente
 * (employee_files) si el empleado adjuntó documentación (certificado
 * médico, permiso, etc.).
 *
 * Flujo:
 *   1. El consolidador detecta ausencia/tardanza → crea registro en
 *      attendance_records con status='absent' o 'late'
 *   2. Opcionalmente, crea expediente automático si la empresa tiene
 *      configurados absence_file_type_id / lateness_file_type_id
 *   3. El empleado (o supervisor) crea una justificación con razón
 *      y opcionalmente enlaza a un expediente
 *   4. El jefe revisa → approve: attendance_records.status→'justified'
 *                       reject: queda como absent/late
 */
export const attendanceJustifications = pgTable(
  'attendance_justifications',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    attendanceId: uuid('attendance_id').notNull(),
    employeeId: uuid('employee_id').notNull(),
    employeeFileId: uuid('employee_file_id'),
    reason: text('reason'),
    /** 'pending' | 'approved' | 'rejected' */
    status: varchar('status', { length: 20 }).notNull().default('pending'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
    reviewedBy: uuid('reviewed_by'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    reviewNotes: text('review_notes'),
  },
  (t) => ({
    attIdx: index('attendance_justifications_att_idx').on(t.attendanceId),
    empIdx: index('attendance_justifications_emp_idx').on(t.employeeId),
  })
)

export type AttendanceJustification = typeof attendanceJustifications.$inferSelect
export type NewAttendanceJustification = typeof attendanceJustifications.$inferInsert
