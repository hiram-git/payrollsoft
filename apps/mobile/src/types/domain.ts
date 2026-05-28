import type { AttendanceDevice } from '@payroll/db/schema/attendance-devices'
/**
 * Contratos de dominio del móvil.
 *
 * NO se duplican tipos: las filas se importan de `@payroll/db` (derivadas
 * de Drizzle con `$inferSelect`/`$inferInsert`) y los enums/uniones de
 * `@payroll/types`. Solo se declara aquí lo que es propio del cliente
 * (DTOs de respuesta del API que no viven en un paquete compartido, y
 * etiquetas de UI).
 *
 * Se importa de los módulos de schema concretos (`@payroll/db/schema/*`)
 * en vez del barrel `@payroll/db`: el barrel reexporta también lógica de
 * provisioning/seed que arrastraría todo el grafo del paquete al
 * typecheck del móvil. Los archivos de schema solo dependen de
 * `drizzle-orm`, así que son la frontera de tipos limpia.
 */
import type { NewAttendancePunch } from '@payroll/db/schema/attendance-punches'
import type { ConnectionMethod } from '@payroll/types'

export type {
  AttendancePunch,
  NewAttendancePunch,
} from '@payroll/db/schema/attendance-punches'
export type { AttendanceDevice } from '@payroll/db/schema/attendance-devices'
export type { ConnectionMethod } from '@payroll/types'

/** Modos del app. Un solo binario, tres flujos de auth distintos. */
export type AppMode = 'kiosk' | 'employee' | 'supervisor'

/**
 * Tipo de marcación. Coincide con `attendance_punches.punch_type`:
 * 0=entrada, 1=salida almuerzo, 2=regreso almuerzo, 3=salida.
 */
export type PunchType = 0 | 1 | 2 | 3

export const PUNCH_TYPE_LABELS: Record<PunchType, string> = {
  0: 'Entrada',
  1: 'Salida a almuerzo',
  2: 'Regreso de almuerzo',
  3: 'Salida',
}

export const PUNCH_TYPE_OPTIONS: { value: PunchType; label: string }[] = [
  { value: 0, label: PUNCH_TYPE_LABELS[0] },
  { value: 1, label: PUNCH_TYPE_LABELS[1] },
  { value: 2, label: PUNCH_TYPE_LABELS[2] },
  { value: 3, label: PUNCH_TYPE_LABELS[3] },
]

/**
 * Payload de creación de un punch individual.
 * `Pick` sobre el tipo de inserción de Drizzle para no divergir del schema.
 */
export type PunchPayload = Pick<NewAttendancePunch, 'employeeId' | 'punchType'> & {
  punchedAt?: string
  deviceId?: string
  source?: ConnectionMethod
  idempotencyKey?: string
}

/**
 * Respuesta de `GET /attendance/punches` (timeline unificado).
 *
 * Espeja el DTO `UnifiedPunch` del servicio en `apps/api`. Se redeclara
 * aquí a propósito: importar de `apps/api` acoplaría dos apps hermanas,
 * lo cual la tarea prohíbe explícitamente. Si en el futuro este DTO se
 * mueve a `@payroll/types`, debe importarse de ahí.
 */
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

/** Subconjunto de `AttendanceDevice` que el móvil consume del listado. */
export type DeviceSummary = Pick<
  AttendanceDevice,
  'id' | 'code' | 'name' | 'deviceType' | 'status' | 'latitude' | 'longitude'
>
