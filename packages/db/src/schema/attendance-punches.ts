import {
  bigserial,
  index,
  pgTable,
  smallint,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'

/**
 * Punches individuales (marcaciones_registros).
 *
 * Cada interacción del empleado con un dispositivo de marcación
 * genera UNA fila aquí. La tabla es de alta frecuencia / purgable:
 * los registros de más de N días se pueden borrar porque el resumen
 * diario vive en `attendance_records` (la cabecera).
 *
 * La `idempotency_key` es el mecanismo que evita duplicados cuando
 * se re-importa el mismo TXT o se sincroniza cada 5 minutos:
 *   INSERT ... ON CONFLICT (idempotency_key) DO NOTHING
 *
 * Formato de key recomendado:
 *   "{deviceCode}:{employeeCode}:{YYYYMMDD_HHMMSS}"
 *
 * Tamaño por fila: ~120 bytes (sin JSONB, sin texto largo).
 * 1000 empleados × 4 punches/día × 365 días = ~1.46M filas/año
 * ≈ 175 MB/año — manejable, y purgable.
 */
export const attendancePunches = pgTable(
  'attendance_punches',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    employeeId: uuid('employee_id').notNull(),
    deviceId: uuid('device_id'),
    punchedAt: timestamp('punched_at', { withTimezone: true }).notNull(),
    /** 0=entrada, 1=salida_almuerzo, 2=regreso_almuerzo, 3=salida, 9=desconocido */
    punchType: smallint('punch_type').notNull().default(0),
    /** import | api | manual | facial */
    source: varchar('source', { length: 20 }).notNull().default('import'),
    idempotencyKey: varchar('idempotency_key', { length: 120 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    idemUnique: uniqueIndex('attendance_punches_idem_unique').on(t.idempotencyKey),
    employeeDateIdx: index('attendance_punches_employee_date_idx').on(t.employeeId, t.punchedAt),
    deviceIdx: index('attendance_punches_device_idx').on(t.deviceId),
  })
)

export type AttendancePunch = typeof attendancePunches.$inferSelect
export type NewAttendancePunch = typeof attendancePunches.$inferInsert
