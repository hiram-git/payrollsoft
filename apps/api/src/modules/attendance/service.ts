import {
  type CreateAttendanceData,
  type CreateShiftData,
  type UpdateAttendanceData,
  createShift,
  deleteAttendanceRecord,
  deleteShift,
  getAttendanceRecord,
  getShift,
  listAttendanceRecords,
  listShifts,
  updateAttendanceById,
  updateShift,
  upsertAttendanceRecord,
} from '@payroll/db'

// biome-ignore lint/suspicious/noExplicitAny: intentional generic DB type
type AnyDb = any

// ─── Shifts ───────────────────────────────────────────────────────────────────

export function listShiftsService(db: AnyDb) {
  return listShifts(db)
}

export async function getShiftService(db: AnyDb, id: string) {
  const shift = await getShift(db, id)
  if (!shift)
    return { success: false as const, error: 'not_found', message: 'Horario no encontrado' }
  return { success: true as const, data: shift }
}

export async function createShiftService(db: AnyDb, input: CreateShiftData) {
  if (!input.name?.trim()) {
    return { success: false as const, error: 'validation', message: 'El nombre es requerido' }
  }
  if (!input.entryTime) {
    return {
      success: false as const,
      error: 'validation',
      message: 'La hora de entrada es requerida',
    }
  }
  if (!input.exitTime) {
    return {
      success: false as const,
      error: 'validation',
      message: 'La hora de salida es requerida',
    }
  }
  const shift = await createShift(db, { ...input, name: input.name.trim() })
  return { success: true as const, data: shift }
}

export async function updateShiftService(db: AnyDb, id: string, input: Partial<CreateShiftData>) {
  const existing = await getShift(db, id)
  if (!existing)
    return { success: false as const, error: 'not_found', message: 'Horario no encontrado' }
  const shift = await updateShift(db, id, input)
  return { success: true as const, data: shift }
}

export async function deleteShiftService(db: AnyDb, id: string) {
  const existing = await getShift(db, id)
  if (!existing)
    return { success: false as const, error: 'not_found', message: 'Horario no encontrado' }
  await deleteShift(db, id)
  return { success: true as const }
}

// ─── Attendance Records ────────────────────────────────────────────────────────

export function listAttendanceService(
  db: AnyDb,
  filter: { date?: string; employeeId?: string; from?: string; to?: string } = {}
) {
  return listAttendanceRecords(db, filter)
}

export async function getAttendanceService(db: AnyDb, id: string) {
  const row = await getAttendanceRecord(db, id)
  if (!row)
    return { success: false as const, error: 'not_found', message: 'Registro no encontrado' }
  return { success: true as const, data: row }
}

export async function upsertAttendanceService(db: AnyDb, input: CreateAttendanceData) {
  if (!input.employeeId) {
    return { success: false as const, error: 'validation', message: 'El empleado es requerido' }
  }
  if (!input.date) {
    return { success: false as const, error: 'validation', message: 'La fecha es requerida' }
  }
  const record = await upsertAttendanceRecord(db, input)
  return { success: true as const, data: record }
}

export async function updateAttendanceService(db: AnyDb, id: string, input: UpdateAttendanceData) {
  const existing = await getAttendanceRecord(db, id)
  if (!existing)
    return { success: false as const, error: 'not_found', message: 'Registro no encontrado' }
  const record = await updateAttendanceById(db, id, input)
  return { success: true as const, data: record }
}

export async function deleteAttendanceService(db: AnyDb, id: string) {
  const existing = await getAttendanceRecord(db, id)
  if (!existing)
    return { success: false as const, error: 'not_found', message: 'Registro no encontrado' }
  await deleteAttendanceRecord(db, id)
  return { success: true as const }
}
