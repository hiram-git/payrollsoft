/**
 * Facial-recognition service.
 *
 * Responsibilities:
 *   - Enroll an employee (store a face embedding + optional photo URL).
 *   - Match an incoming embedding against the enrollments via pgvector.
 *   - Persist marcaciones with idempotency-key dedupe (so kiosk replays
 *     after coming back online don't double-count).
 *   - Consolidate a day's marcaciones into the existing
 *     attendance_records table so payroll keeps reading from one place.
 *   - Manage kiosk terminals (registry + token rotation).
 *
 * All DB access is funnelled through Drizzle's typed schema; raw SQL is
 * only used where pgvector operators are required.
 */
import { randomBytes } from 'node:crypto'
import { type ConsolidatedDay, type ShiftSnapshot, consolidateDay } from '@payroll/core/attendance'
import {
  attendanceRecords,
  employees,
  facialEnrollments,
  facialMarcaciones,
  facialTerminalEvents,
  facialTerminals,
  shifts,
  workCalendar,
} from '@payroll/db'
import type {
  FacialEnrollInput,
  FacialMarcacionBatchInput,
  FacialMatchInput,
  FacialMatchResult,
  FacialTerminalInput,
  MarcacionInput,
  MarcacionKind,
} from '@payroll/types'
import { and, asc, count, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm'
import { distanceToConfidence, normaliseEmbedding, searchSimilarEmbeddings } from './vector'

// biome-ignore lint/suspicious/noExplicitAny: intentional generic db type
type AnyDb = any

const DEFAULT_MATCH_THRESHOLD = 0.4

// ─── Enrollments ──────────────────────────────────────────────────────────────

export async function listEnrollmentsService(
  db: AnyDb,
  filter: { employeeId?: string; status?: string } = {}
) {
  const conditions = []
  if (filter.employeeId) conditions.push(eq(facialEnrollments.employeeId, filter.employeeId))
  if (filter.status) conditions.push(eq(facialEnrollments.status, filter.status))
  const rows = await db
    .select({
      id: facialEnrollments.id,
      employeeId: facialEnrollments.employeeId,
      qualityScore: facialEnrollments.qualityScore,
      isPrimary: facialEnrollments.isPrimary,
      status: facialEnrollments.status,
      photoUrl: facialEnrollments.photoUrl,
      enrolledAt: facialEnrollments.enrolledAt,
      revokedAt: facialEnrollments.revokedAt,
      notes: facialEnrollments.notes,
    })
    .from(facialEnrollments)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(facialEnrollments.enrolledAt))
  return rows
}

export async function createEnrollmentService(
  db: AnyDb,
  input: FacialEnrollInput,
  enrolledByUserId: string | undefined
) {
  // Sanity check: employee must exist in this tenant.
  const [emp] = await db
    .select({ id: employees.id })
    .from(employees)
    .where(eq(employees.id, input.employeeId))
    .limit(1)
  if (!emp) {
    return { success: false as const, error: 'not_found', message: 'Empleado no encontrado' }
  }

  const embedding = normaliseEmbedding(input.embedding)

  // If `isPrimary`, demote any previous primary for this employee.
  if (input.isPrimary) {
    await db
      .update(facialEnrollments)
      .set({ isPrimary: false })
      .where(
        and(
          eq(facialEnrollments.employeeId, input.employeeId),
          eq(facialEnrollments.isPrimary, true)
        )
      )
  }

  const [row] = await db
    .insert(facialEnrollments)
    .values({
      employeeId: input.employeeId,
      embedding,
      photoUrl: input.photoUrl ?? null,
      qualityScore: input.qualityScore !== undefined ? String(input.qualityScore) : null,
      isPrimary: input.isPrimary ?? false,
      notes: input.notes ?? null,
      enrolledByUserId: enrolledByUserId ?? null,
    })
    .returning({
      id: facialEnrollments.id,
      employeeId: facialEnrollments.employeeId,
      enrolledAt: facialEnrollments.enrolledAt,
      isPrimary: facialEnrollments.isPrimary,
    })

  return { success: true as const, data: row }
}

export async function revokeEnrollmentService(db: AnyDb, id: string) {
  const [row] = await db
    .update(facialEnrollments)
    .set({ status: 'revoked', revokedAt: new Date() })
    .where(eq(facialEnrollments.id, id))
    .returning({ id: facialEnrollments.id })
  if (!row) {
    return { success: false as const, error: 'not_found', message: 'Enrollment no encontrado' }
  }
  return { success: true as const }
}

// ─── Matching ─────────────────────────────────────────────────────────────────

export async function matchEmbeddingService(
  db: AnyDb,
  input: FacialMatchInput
): Promise<{ success: true; data: FacialMatchResult }> {
  const embedding = normaliseEmbedding(input.embedding)
  const threshold = input.threshold ?? DEFAULT_MATCH_THRESHOLD

  const candidates = await searchSimilarEmbeddings(db, embedding, { limit: 3 })
  const best = candidates[0]

  if (!best || best.distance > threshold) {
    return { success: true, data: { matched: false } }
  }

  const [emp] = await db
    .select({
      code: employees.code,
      firstName: employees.firstName,
      lastName: employees.lastName,
      department: employees.department,
      position: employees.position,
    })
    .from(employees)
    .where(eq(employees.id, best.employeeId))
    .limit(1)

  return {
    success: true,
    data: {
      matched: true,
      employeeId: best.employeeId,
      enrollmentId: best.enrollmentId,
      distance: best.distance,
      confidence: distanceToConfidence(best.distance),
      employee: emp,
    },
  }
}

// ─── Marcaciones (raw events) ────────────────────────────────────────────────

async function resolveTerminalId(db: AnyDb, code: string | undefined): Promise<string | null> {
  if (!code) return null
  const [t] = await db
    .select({ id: facialTerminals.id })
    .from(facialTerminals)
    .where(eq(facialTerminals.code, code))
    .limit(1)
  if (!t) return null
  // Best-effort touch — kiosk heartbeat.
  await db
    .update(facialTerminals)
    .set({ lastSeenAt: new Date() })
    .where(eq(facialTerminals.id, t.id))
  return t.id
}

export async function ingestMarcacionesService(db: AnyDb, input: FacialMarcacionBatchInput) {
  const accepted: Array<{ id: string; idempotencyKey: string; deduped: boolean }> = []
  const rejected: Array<{ idempotencyKey: string; reason: string }> = []
  const dayKeys = new Set<string>() // "employeeId|YYYY-MM-DD" for follow-up consolidation

  for (const m of input.items) {
    const terminalId = await resolveTerminalId(db, m.terminalCode)
    // Idempotency: a kiosk replay must not duplicate the event.
    const [existing] = await db
      .select({ id: facialMarcaciones.id })
      .from(facialMarcaciones)
      .where(eq(facialMarcaciones.idempotencyKey, m.idempotencyKey))
      .limit(1)
    if (existing) {
      accepted.push({ id: existing.id, idempotencyKey: m.idempotencyKey, deduped: true })
      continue
    }

    const capturedAt = new Date(m.capturedAt)
    if (Number.isNaN(capturedAt.getTime())) {
      rejected.push({ idempotencyKey: m.idempotencyKey, reason: 'invalid_capturedAt' })
      continue
    }

    const [row] = await db
      .insert(facialMarcaciones)
      .values({
        employeeId: m.employeeId ?? null,
        terminalId,
        kind: m.kind,
        capturedAt,
        confidence: m.confidence !== undefined ? String(m.confidence) : null,
        matchDistance: m.matchDistance !== undefined ? String(m.matchDistance) : null,
        livenessScore: m.livenessScore !== undefined ? String(m.livenessScore) : null,
        photoUrl: m.photoUrl ?? null,
        matchedEnrollmentId: m.matchedEnrollmentId ?? null,
        idempotencyKey: m.idempotencyKey,
        clientEventId: m.clientEventId ?? null,
        source: m.source ?? 'kiosk',
        status: m.employeeId ? 'verified' : 'pending',
        deviceMeta: m.deviceMeta ?? {},
      })
      .returning({ id: facialMarcaciones.id })

    accepted.push({ id: row.id, idempotencyKey: m.idempotencyKey, deduped: false })
    if (m.employeeId) {
      dayKeys.add(`${m.employeeId}|${capturedAt.toISOString().slice(0, 10)}`)
    }
  }

  // Eager-consolidate the days that received new events — keeps the
  // dashboard fresh without waiting for a background job.
  for (const k of dayKeys) {
    const [employeeId, date] = k.split('|')
    await consolidateAttendanceForEmployee(db, employeeId, date).catch(() => {})
  }

  return { success: true as const, data: { accepted, rejected } }
}

export async function listMarcacionesService(
  db: AnyDb,
  filter: { date?: string; employeeId?: string; from?: string; to?: string; status?: string } = {}
) {
  const conditions = []
  if (filter.date) {
    const day = filter.date
    conditions.push(
      and(
        gte(facialMarcaciones.capturedAt, new Date(`${day}T00:00:00`)),
        lte(facialMarcaciones.capturedAt, new Date(`${day}T23:59:59.999`))
      )
    )
  }
  if (filter.from) conditions.push(gte(facialMarcaciones.capturedAt, new Date(filter.from)))
  if (filter.to) conditions.push(lte(facialMarcaciones.capturedAt, new Date(filter.to)))
  if (filter.employeeId) conditions.push(eq(facialMarcaciones.employeeId, filter.employeeId))
  if (filter.status) conditions.push(eq(facialMarcaciones.status, filter.status))

  const rows = await db
    .select({
      marcacion: facialMarcaciones,
      employee: {
        id: employees.id,
        code: employees.code,
        firstName: employees.firstName,
        lastName: employees.lastName,
        department: employees.department,
        position: employees.position,
      },
    })
    .from(facialMarcaciones)
    .leftJoin(employees, eq(facialMarcaciones.employeeId, employees.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(facialMarcaciones.capturedAt))
    .limit(500)

  return rows
}

export async function recordManualMarcacionService(
  db: AnyDb,
  input: { employeeId: string; kind: MarcacionKind; capturedAt: string; justification: string },
  supervisorUserId: string
) {
  const idempotencyKey = `manual_${input.employeeId}_${input.kind}_${input.capturedAt}_${randomBytes(4).toString('hex')}`
  const capturedAt = new Date(input.capturedAt)

  const [row] = await db
    .insert(facialMarcaciones)
    .values({
      employeeId: input.employeeId,
      kind: input.kind,
      capturedAt,
      idempotencyKey,
      source: 'manual',
      status: 'manual',
      supervisorUserId,
      justification: input.justification,
    })
    .returning({ id: facialMarcaciones.id })

  await consolidateAttendanceForEmployee(
    db,
    input.employeeId,
    capturedAt.toISOString().slice(0, 10)
  )

  return { success: true as const, data: row }
}

export async function justifyMarcacionService(
  db: AnyDb,
  id: string,
  justification: string,
  supervisorUserId: string
) {
  const [row] = await db
    .update(facialMarcaciones)
    .set({ status: 'manual', justification, supervisorUserId })
    .where(eq(facialMarcaciones.id, id))
    .returning({
      id: facialMarcaciones.id,
      employeeId: facialMarcaciones.employeeId,
      capturedAt: facialMarcaciones.capturedAt,
    })
  if (!row)
    return { success: false as const, error: 'not_found', message: 'Marcación no encontrada' }
  if (row.employeeId) {
    await consolidateAttendanceForEmployee(
      db,
      row.employeeId,
      new Date(row.capturedAt).toISOString().slice(0, 10)
    ).catch(() => {})
  }
  return { success: true as const }
}

// ─── Consolidation ────────────────────────────────────────────────────────────

async function loadShiftForEmployee(_db: AnyDb): Promise<ShiftSnapshot | null> {
  // No shift-per-employee assignment table exists yet — fall back to the
  // company default. When the shifts-assignment module ships, replace
  // this with a join via the employee row.
  const [row] = await _db.select().from(shifts).where(eq(shifts.isDefault, true)).limit(1)
  if (!row) return null
  return {
    entryTime: String(row.entryTime),
    exitTime: String(row.exitTime),
    lunchStartTime: row.lunchStartTime as string | null,
    lunchEndTime: row.lunchEndTime as string | null,
    entryToleranceAfter: row.entryToleranceAfter ?? 0,
    exitToleranceBefore: row.exitToleranceBefore ?? 0,
    lunchStartToleranceAfter: row.lunchStartToleranceAfter ?? 0,
    lunchEndToleranceAfter: row.lunchEndToleranceAfter ?? 0,
    weekdays: row.weekdays ?? [1, 2, 3, 4, 5],
  }
}

async function loadCalendarEntry(db: AnyDb, date: string) {
  const [row] = await db.select().from(workCalendar).where(eq(workCalendar.date, date)).limit(1)
  return row ?? null
}

export async function consolidateAttendanceForEmployee(
  db: AnyDb,
  employeeId: string,
  date: string
): Promise<ConsolidatedDay> {
  const dayStart = new Date(`${date}T00:00:00`)
  const dayEnd = new Date(`${date}T23:59:59.999`)

  const rows = await db
    .select({
      id: facialMarcaciones.id,
      kind: facialMarcaciones.kind,
      capturedAt: facialMarcaciones.capturedAt,
      status: facialMarcaciones.status,
    })
    .from(facialMarcaciones)
    .where(
      and(
        eq(facialMarcaciones.employeeId, employeeId),
        gte(facialMarcaciones.capturedAt, dayStart),
        lte(facialMarcaciones.capturedAt, dayEnd)
      )
    )
    .orderBy(asc(facialMarcaciones.capturedAt))

  const shift = await loadShiftForEmployee(db)
  const calendarRow = await loadCalendarEntry(db, date)

  const consolidated = consolidateDay({
    employeeId,
    date,
    shift,
    calendar: calendarRow ? { date, isWorkday: calendarRow.isWorkday, shiftOverride: null } : null,
    marcaciones: rows.map((r) => ({
      employeeId,
      kind: r.kind as MarcacionKind,
      capturedAt: r.capturedAt as Date,
      status: r.status as 'verified' | 'pending' | 'rejected' | 'manual',
    })),
  })

  // Upsert into the canonical attendance_records table.
  const [existing] = await db
    .select({ id: attendanceRecords.id })
    .from(attendanceRecords)
    .where(and(eq(attendanceRecords.employeeId, employeeId), eq(attendanceRecords.date, date)))
    .limit(1)

  const patch = {
    checkIn: consolidated.checkIn,
    lunchStart: consolidated.lunchStart,
    lunchEnd: consolidated.lunchEnd,
    checkOut: consolidated.checkOut,
    workedMinutes: consolidated.workedMinutes,
    lateMinutes: consolidated.lateMinutes,
    overtimeMinutes: consolidated.overtimeMinutes,
    source: 'facial' as const,
    rawData: {
      status: consolidated.status,
      isAbsent: consolidated.isAbsent,
      isHoliday: consolidated.isHoliday,
      lunchOverMinutes: consolidated.lunchOverMinutes,
      earlyLeaveMinutes: consolidated.earlyLeaveMinutes,
      expectedMinutes: consolidated.expectedMinutes,
    },
  }

  if (existing) {
    await db.update(attendanceRecords).set(patch).where(eq(attendanceRecords.id, existing.id))
  } else {
    await db.insert(attendanceRecords).values({ employeeId, date, ...patch })
  }

  return consolidated
}

export async function consolidateAttendanceForDayService(db: AnyDb, date: string) {
  const dayStart = new Date(`${date}T00:00:00`)
  const dayEnd = new Date(`${date}T23:59:59.999`)
  const rows = await db
    .selectDistinct({ employeeId: facialMarcaciones.employeeId })
    .from(facialMarcaciones)
    .where(
      and(gte(facialMarcaciones.capturedAt, dayStart), lte(facialMarcaciones.capturedAt, dayEnd))
    )

  const results: ConsolidatedDay[] = []
  for (const r of rows) {
    if (!r.employeeId) continue
    results.push(await consolidateAttendanceForEmployee(db, r.employeeId, date))
  }
  return { success: true as const, data: { date, count: results.length, results } }
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

export async function dashboardService(db: AnyDb, date: string) {
  const dayStart = new Date(`${date}T00:00:00`)
  const dayEnd = new Date(`${date}T23:59:59.999`)

  const [total] = await db.select({ c: count() }).from(employees)

  const marcacionesToday = await db
    .select({
      employeeId: facialMarcaciones.employeeId,
      kind: facialMarcaciones.kind,
      capturedAt: facialMarcaciones.capturedAt,
    })
    .from(facialMarcaciones)
    .where(
      and(gte(facialMarcaciones.capturedAt, dayStart), lte(facialMarcaciones.capturedAt, dayEnd))
    )

  const seen = new Set<string>()
  for (const m of marcacionesToday) {
    if (m.employeeId) seen.add(m.employeeId)
  }

  const records = await db
    .select({
      employeeId: attendanceRecords.employeeId,
      workedMinutes: attendanceRecords.workedMinutes,
      lateMinutes: attendanceRecords.lateMinutes,
      overtimeMinutes: attendanceRecords.overtimeMinutes,
      checkIn: attendanceRecords.checkIn,
      checkOut: attendanceRecords.checkOut,
      rawData: attendanceRecords.rawData,
    })
    .from(attendanceRecords)
    .where(eq(attendanceRecords.date, date))

  const empMap = new Map(
    (
      await db
        .select({
          id: employees.id,
          code: employees.code,
          firstName: employees.firstName,
          lastName: employees.lastName,
          department: employees.department,
          position: employees.position,
        })
        .from(employees)
        .where(seen.size > 0 ? inArray(employees.id, [...seen]) : sql`false`)
    ).map((e) => [e.id, e])
  )

  const present = records
    .filter((r) => r.checkIn)
    .map((r) => ({ ...r, employee: r.employeeId ? empMap.get(r.employeeId) : null }))

  const late = records.filter((r) => (r.lateMinutes ?? 0) > 0)
  const overtime = records.filter((r) => (r.overtimeMinutes ?? 0) > 0)

  return {
    success: true as const,
    data: {
      date,
      totals: {
        employees: Number(total?.c ?? 0),
        present: present.length,
        late: late.length,
        overtime: overtime.length,
        absent: Math.max(0, Number(total?.c ?? 0) - present.length),
        marcacionesToday: marcacionesToday.length,
      },
      present,
      lastMarcaciones: marcacionesToday
        .slice()
        .sort((a, b) => +new Date(b.capturedAt) - +new Date(a.capturedAt))
        .slice(0, 25),
    },
  }
}

// ─── Terminals ────────────────────────────────────────────────────────────────

export async function listTerminalsService(db: AnyDb) {
  return db.select().from(facialTerminals).orderBy(asc(facialTerminals.code))
}

export async function createTerminalService(db: AnyDb, input: FacialTerminalInput) {
  const [existing] = await db
    .select({ id: facialTerminals.id })
    .from(facialTerminals)
    .where(eq(facialTerminals.code, input.code))
    .limit(1)
  if (existing) {
    return { success: false as const, error: 'conflict', message: 'Código de terminal en uso' }
  }
  const token = randomBytes(24).toString('hex')
  const tokenHash = await hashToken(token)
  const [row] = await db
    .insert(facialTerminals)
    .values({
      code: input.code,
      name: input.name,
      location: input.location ?? null,
      status: input.status ?? 'active',
      apiTokenHash: tokenHash,
    })
    .returning({ id: facialTerminals.id, code: facialTerminals.code })
  return { success: true as const, data: { ...row, token } }
}

export async function rotateTerminalTokenService(db: AnyDb, id: string) {
  const token = randomBytes(24).toString('hex')
  const tokenHash = await hashToken(token)
  const [row] = await db
    .update(facialTerminals)
    .set({ apiTokenHash: tokenHash, updatedAt: new Date() })
    .where(eq(facialTerminals.id, id))
    .returning({ id: facialTerminals.id, code: facialTerminals.code })
  if (!row)
    return { success: false as const, error: 'not_found', message: 'Terminal no encontrada' }
  return { success: true as const, data: { ...row, token } }
}

export async function deleteTerminalService(db: AnyDb, id: string) {
  const [row] = await db
    .delete(facialTerminals)
    .where(eq(facialTerminals.id, id))
    .returning({ id: facialTerminals.id })
  if (!row)
    return { success: false as const, error: 'not_found', message: 'Terminal no encontrada' }
  return { success: true as const }
}

export async function recordTerminalHeartbeatService(
  db: AnyDb,
  terminalId: string,
  payload: Record<string, unknown>
) {
  await db
    .update(facialTerminals)
    .set({ lastSeenAt: new Date(), appVersion: payload.version as string | undefined })
    .where(eq(facialTerminals.id, terminalId))
  await db.insert(facialTerminalEvents).values({ terminalId, kind: 'heartbeat', payload })
  return { success: true as const }
}

// ─── Misc ─────────────────────────────────────────────────────────────────────

async function hashToken(token: string): Promise<string> {
  const hasher = new Bun.CryptoHasher('sha256')
  hasher.update(token)
  return hasher.digest('hex')
}
