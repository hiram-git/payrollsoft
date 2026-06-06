/**
 * Seed `attendance` — marcaciones (punches) + resumen diario del mes pasado.
 *
 * Genera, para cada empleado activo y cada día laborable del mes anterior:
 *   - 2% de probabilidad de AUSENCIA: sin punches; attendance_records con
 *     status 'absent'.
 *   - 5% de probabilidad de TARDANZA: entrada después de la tolerancia;
 *     status 'late' con late_minutes.
 *   - El resto: presente, con jitter realista alrededor del horario.
 *
 * Inserta tanto los punches crudos (`attendance_punches`, con punch_type
 * 0=entrada / 1=salida_almuerzo / 2=regreso_almuerzo / 3=salida) como el
 * resumen consolidado (`attendance_records`) coherente con esos punches.
 *
 * No abre conexiones — el caller pasa un `postgres.Sql` apuntando al
 * schema del tenant. No llama process.exit; los errores se propagan.
 *
 * Re-ejecutable: borra primero los punches/registros del rango con
 * source='seed' antes de insertar, para no acumular duplicados.
 */
import type postgres from 'postgres'

export type SeedAttendanceOptions = {
  /** Probabilidad de ausencia por día-empleado (0..1). Default 0.02. */
  absenceRate?: number
  /** Probabilidad de tardanza por día-empleado (0..1). Default 0.05. */
  latenessRate?: number
  /**
   * Mes a sembrar como offset respecto al actual: -1 = mes pasado (default),
   * 0 = mes en curso, etc.
   */
  monthOffset?: number
  /** Semilla para reproducibilidad. Default 42. */
  seed?: number
  log?: (line: string) => void
}

export type SeedAttendanceResult = {
  employees: number
  workdays: number
  present: number
  late: number
  absent: number
  punches: number
}

type ShiftRow = {
  entry_time: string
  exit_time: string
  lunch_start_time: string | null
  lunch_end_time: string | null
  entry_tolerance_after: number
  weekdays: number[]
}

type EmployeeRow = { id: string; code: string; shift_id: string | null }

/** PRNG determinista (mulberry32) para resultados reproducibles. */
function makeRng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** "HH:MM[:SS]" → minutos desde medianoche. */
function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

/** Date (UTC base del día) + minutos desde medianoche → Date. */
function atMinutes(day: Date, minutes: number): Date {
  const d = new Date(day)
  d.setHours(0, minutes, 0, 0)
  return d
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

/** Date → 'YYYY-MM-DD' (en hora local del proceso). */
function ymd(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Date → ISO 'YYYY-MM-DD HH:MM:SS' sin zona (timestamp naive). */
function isoTs(d: Date): string {
  return `${ymd(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

const DEFAULT_SHIFT: ShiftRow = {
  entry_time: '08:00',
  exit_time: '17:00',
  lunch_start_time: '12:00',
  lunch_end_time: '13:00',
  entry_tolerance_after: 5,
  weekdays: [1, 2, 3, 4, 5],
}

export async function seedAttendance(
  sql: postgres.Sql,
  opts: SeedAttendanceOptions = {}
): Promise<SeedAttendanceResult> {
  const absenceRate = opts.absenceRate ?? 0.02
  const latenessRate = opts.latenessRate ?? 0.05
  const monthOffset = opts.monthOffset ?? -1
  const log = opts.log ?? (() => {})
  const rng = makeRng(opts.seed ?? 42)

  // ── Rango del mes objetivo ────────────────────────────────────────────
  const now = new Date()
  const first = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1)
  const last = new Date(now.getFullYear(), now.getMonth() + monthOffset + 1, 0)
  const fromStr = ymd(first)
  const toStr = ymd(last)
  log(`▸ Asistencia → rango ${fromStr} … ${toStr}`)

  // ── Turno por defecto (para empleados sin turno asignado) ─────────────
  const [defShift] = await sql<Array<Partial<ShiftRow>>>`
    SELECT entry_time, exit_time, lunch_start_time, lunch_end_time,
           entry_tolerance_after, weekdays
    FROM shifts
    ORDER BY is_default DESC, created_at ASC
    LIMIT 1
  `
  const fallbackShift: ShiftRow = { ...DEFAULT_SHIFT, ...(defShift ?? {}) } as ShiftRow

  // ── Turnos por id (para resolver el de cada empleado) ─────────────────
  const shiftRows = await sql<Array<ShiftRow & { id: string }>>`
    SELECT id, entry_time, exit_time, lunch_start_time, lunch_end_time,
           entry_tolerance_after, weekdays
    FROM shifts
  `
  const shiftById = new Map(shiftRows.map((s) => [s.id, s]))

  // ── Empleados activos ─────────────────────────────────────────────────
  const employees = await sql<EmployeeRow[]>`
    SELECT id, code, shift_id FROM employees WHERE is_active = true
  `
  if (employees.length === 0) {
    log('  ⚠ No hay empleados activos; nada que sembrar.')
    return { employees: 0, workdays: 0, present: 0, late: 0, absent: 0, punches: 0 }
  }
  log(`  · ${employees.length} empleados activos`)

  // ── Limpieza idempotente del rango (solo lo sembrado) ─────────────────
  await sql`
    DELETE FROM attendance_punches
    WHERE source = 'seed'
      AND punched_at >= ${`${fromStr} 00:00:00`}::timestamp
      AND punched_at <= ${`${toStr} 23:59:59`}::timestamp
  `
  await sql`
    DELETE FROM attendance_records
    WHERE source = 'seed' AND date >= ${fromStr}::date AND date <= ${toStr}::date
  `

  // ── Generación ────────────────────────────────────────────────────────
  type PunchInsert = {
    employee_id: string
    punched_at: string
    punch_type: number
    source: string
    idempotency_key: string
  }
  type RecordInsert = {
    employee_id: string
    date: string
    check_in: string | null
    check_out: string | null
    lunch_start: string | null
    lunch_end: string | null
    worked_minutes: number
    late_minutes: number
    overtime_minutes: number
    status: string
    shift_id: string | null
    source: string
  }

  const punches: PunchInsert[] = []
  const records: RecordInsert[] = []
  let present = 0
  let late = 0
  let absent = 0
  let workdays = 0

  for (const emp of employees) {
    const shift = (emp.shift_id && shiftById.get(emp.shift_id)) || fallbackShift
    const entryMin = timeToMinutes(shift.entry_time)
    const exitMin = timeToMinutes(shift.exit_time)
    const lunchStartMin = shift.lunch_start_time ? timeToMinutes(shift.lunch_start_time) : null
    const lunchEndMin = shift.lunch_end_time ? timeToMinutes(shift.lunch_end_time) : null
    const tolerance = Number(shift.entry_tolerance_after ?? 0)
    const weekdays = shift.weekdays?.length ? shift.weekdays : [1, 2, 3, 4, 5]

    for (let d = new Date(first); d <= last; d.setDate(d.getDate() + 1)) {
      // ISO weekday: 1=Mon..7=Sun
      const isoDow = d.getDay() === 0 ? 7 : d.getDay()
      if (!weekdays.includes(isoDow)) continue
      workdays++

      const day = new Date(d)
      const dateStr = ymd(day)
      const roll = rng()

      // ── Ausencia ──────────────────────────────────────────────────────
      if (roll < absenceRate) {
        absent++
        records.push({
          employee_id: emp.id,
          date: dateStr,
          check_in: null,
          check_out: null,
          lunch_start: null,
          lunch_end: null,
          worked_minutes: 0,
          late_minutes: 0,
          overtime_minutes: 0,
          status: 'absent',
          shift_id: emp.shift_id,
          source: 'seed',
        })
        continue
      }

      // ── Tardanza vs presente ──────────────────────────────────────────
      const isLate = roll < absenceRate + latenessRate
      // Minutos de retraso si llega tarde: tolerancia + 5..40 min.
      const lateBy = isLate ? tolerance + 5 + Math.floor(rng() * 36) : 0
      // Jitter normal de un empleado puntual: -4..+tolerancia min.
      const onTimeJitter = Math.floor(rng() * (tolerance + 5)) - 4
      const checkInMin = entryMin + (isLate ? lateBy : onTimeJitter)
      // Salida: hora de salida + -5..+20 (a veces algo de extra).
      const checkOutMin = exitMin + (Math.floor(rng() * 26) - 5)

      const checkIn = atMinutes(day, checkInMin)
      const checkOut = atMinutes(day, checkOutMin)
      const lunchStart = lunchStartMin != null ? atMinutes(day, lunchStartMin) : null
      const lunchEnd = lunchEndMin != null ? atMinutes(day, lunchEndMin) : null

      const lunchSpan =
        lunchStartMin != null && lunchEndMin != null ? lunchEndMin - lunchStartMin : 0
      const grossMinutes = Math.max(0, checkOutMin - checkInMin)
      const workedMinutes = Math.max(0, grossMinutes - lunchSpan)
      const scheduledWorked = Math.max(0, exitMin - entryMin - lunchSpan)
      const overtime = Math.max(0, workedMinutes - scheduledWorked)
      const lateMinutes = isLate ? Math.max(0, checkInMin - entryMin - tolerance) : 0

      if (isLate) late++
      else present++

      // Punches (idempotencyKey: seed:{code}:{YYYYMMDD}:{type})
      const dateKey = dateStr.replace(/-/g, '')
      const pushPunch = (at: Date, type: number) =>
        punches.push({
          employee_id: emp.id,
          punched_at: isoTs(at),
          punch_type: type,
          source: 'seed',
          idempotency_key: `seed:${emp.code}:${dateKey}:${type}`,
        })

      pushPunch(checkIn, 0)
      if (lunchStart) pushPunch(lunchStart, 1)
      if (lunchEnd) pushPunch(lunchEnd, 2)
      pushPunch(checkOut, 3)

      records.push({
        employee_id: emp.id,
        date: dateStr,
        check_in: isoTs(checkIn),
        check_out: isoTs(checkOut),
        lunch_start: lunchStart ? isoTs(lunchStart) : null,
        lunch_end: lunchEnd ? isoTs(lunchEnd) : null,
        worked_minutes: workedMinutes,
        late_minutes: lateMinutes,
        overtime_minutes: overtime,
        status: isLate ? 'late' : 'present',
        shift_id: emp.shift_id,
        source: 'seed',
      })
    }
  }

  // ── Inserción por lotes ───────────────────────────────────────────────
  const CHUNK = 1000
  for (let i = 0; i < punches.length; i += CHUNK) {
    const slice = punches.slice(i, i + CHUNK)
    await sql`
      INSERT INTO attendance_punches ${sql(
        slice,
        'employee_id',
        'punched_at',
        'punch_type',
        'source',
        'idempotency_key'
      )}
      ON CONFLICT (idempotency_key) DO NOTHING
    `
  }
  for (let i = 0; i < records.length; i += CHUNK) {
    const slice = records.slice(i, i + CHUNK)
    await sql`
      INSERT INTO attendance_records ${sql(
        slice,
        'employee_id',
        'date',
        'check_in',
        'check_out',
        'lunch_start',
        'lunch_end',
        'worked_minutes',
        'late_minutes',
        'overtime_minutes',
        'status',
        'shift_id',
        'source'
      )}
    `
  }

  const totalDayRecords = present + late + absent
  log(
    `  · ${records.length} registros · ${punches.length} punches · ` +
      `presentes ${present} (${pct(present, totalDayRecords)}), ` +
      `tarde ${late} (${pct(late, totalDayRecords)}), ` +
      `ausentes ${absent} (${pct(absent, totalDayRecords)})`
  )

  return {
    employees: employees.length,
    workdays,
    present,
    late,
    absent,
    punches: punches.length,
  }
}

function pct(n: number, total: number): string {
  if (total === 0) return '0%'
  return `${((n / total) * 100).toFixed(1)}%`
}
