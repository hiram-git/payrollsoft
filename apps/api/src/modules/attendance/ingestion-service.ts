import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { parseBiometricTxt } from '@payroll/core/attendance'
import {
  attendanceDevices,
  attendanceIngestionLog,
  attendanceIngestionState,
  attendancePunches,
  employees,
} from '@payroll/db'
import { desc, eq, sql } from 'drizzle-orm'

// biome-ignore lint/suspicious/noExplicitAny: drizzle generic
type AnyDb = any

export async function getIngestionState(db: AnyDb, deviceId: string) {
  const [row] = await db
    .select()
    .from(attendanceIngestionState)
    .where(eq(attendanceIngestionState.deviceId, deviceId))
    .limit(1)
  return row ?? null
}

export async function listIngestionStates(db: AnyDb) {
  return db.select().from(attendanceIngestionState).orderBy(attendanceIngestionState.createdAt)
}

export async function upsertIngestionState(
  db: AnyDb,
  deviceId: string,
  patch: { status?: string; intervalMinutes?: number; autoStart?: boolean }
) {
  const existing = await getIngestionState(db, deviceId)
  if (existing) {
    const set: Record<string, unknown> = { updatedAt: new Date() }
    if (patch.status !== undefined) set.status = patch.status
    if (patch.intervalMinutes !== undefined) set.intervalMinutes = patch.intervalMinutes
    if (patch.autoStart !== undefined) set.autoStart = patch.autoStart
    await db
      .update(attendanceIngestionState)
      .set(set)
      .where(eq(attendanceIngestionState.id, existing.id))
    return { ...(existing as Record<string, unknown>), ...set }
  }
  const [row] = await db
    .insert(attendanceIngestionState)
    .values({
      deviceId,
      status: patch.status ?? 'stopped',
      intervalMinutes: patch.intervalMinutes ?? 5,
      autoStart: patch.autoStart ?? false,
    })
    .returning()
  return row
}

export async function listIngestionLog(db: AnyDb, deviceId: string, limit = 50) {
  return db
    .select()
    .from(attendanceIngestionLog)
    .where(eq(attendanceIngestionLog.deviceId, deviceId))
    .orderBy(desc(attendanceIngestionLog.createdAt))
    .limit(Math.min(limit, 200))
}

async function buildEmployeeMap(db: AnyDb): Promise<Map<string, string>> {
  const rows = await db
    .select({ id: employees.id, code: employees.code })
    .from(employees)
    .where(eq(employees.isActive, true))
  const map = new Map<string, string>()
  for (const r of rows as Array<{ id: string; code: string }>) {
    map.set(r.code.toUpperCase().trim(), r.id)
  }
  return map
}

export type IngestionResult = {
  punchesFound: number
  punchesNew: number
  punchesSkipped: number
  unknownEmployees: number
  highWaterBefore: string | null
  highWaterAfter: string | null
  error?: string
}

export async function runIngestionCycle(db: AnyDb, deviceId: string): Promise<IngestionResult> {
  const [device] = await db
    .select()
    .from(attendanceDevices)
    .where(eq(attendanceDevices.id, deviceId))
    .limit(1)
  if (!device) throw new Error(`Device ${deviceId} not found`)

  const state = await getIngestionState(db, deviceId)
  const hwmBefore = state?.highWaterMark ? (state.highWaterMark as Date).toISOString() : null
  const startedAt = new Date()

  const connMethod = device.connectionMethod as string
  if (connMethod === 'txt_import') {
    return runTxtIngestion(db, device, state, startedAt, hwmBefore)
  }
  if (connMethod === 'api') {
    return runApiIngestion(db, device, state, startedAt, hwmBefore)
  }
  if (connMethod === 'sdk') {
    const msg =
      'SDK ingestion is not yet implemented. This feature requires a concrete manufacturer SDK ' +
      '(e.g., ZKTeco, Anviz) to be integrated. Configure the device as txt_import or api instead.'
    await writeIngestionLog(db, deviceId, startedAt, 'error', {}, hwmBefore, hwmBefore, msg)
    return emptyResult(hwmBefore, msg)
  }

  const msg = `Connection method "${connMethod}" is direct_write and does not use the ingestion worker.`
  await db.insert(attendanceIngestionLog).values({
    deviceId,
    startedAt,
    finishedAt: new Date(),
    status: 'error',
    errorMessage: msg,
  })
  return {
    punchesFound: 0,
    punchesNew: 0,
    punchesSkipped: 0,
    unknownEmployees: 0,
    highWaterBefore: hwmBefore,
    highWaterAfter: hwmBefore,
    error: msg,
  }
}

async function runTxtIngestion(
  db: AnyDb,
  device: Record<string, unknown>,
  state: Record<string, unknown> | null,
  startedAt: Date,
  hwmBefore: string | null
): Promise<IngestionResult> {
  const deviceId = device.id as string
  const sourcePath = device.syncSourcePath as string | null
  if (!sourcePath) {
    const msg = 'sync_source_path no configurado para este dispositivo.'
    await writeIngestionLog(db, deviceId, startedAt, 'error', {}, hwmBefore, hwmBefore, msg)
    return emptyResult(hwmBefore, msg)
  }

  let content: string
  try {
    content = await readFile(sourcePath, 'utf-8')
  } catch (err) {
    const msg = `No se pudo leer ${sourcePath}: ${err instanceof Error ? err.message : err}`
    await writeIngestionLog(db, deviceId, startedAt, 'error', {}, hwmBefore, hwmBefore, msg)
    return emptyResult(hwmBefore, msg)
  }

  const fileHash = createHash('sha256').update(content).digest('hex')
  const lastHash = state?.lastFileHash as string | null
  if (lastHash && lastHash === fileHash) {
    await writeIngestionLog(db, deviceId, startedAt, 'success', {}, hwmBefore, hwmBefore, null)
    await touchLastRun(db, deviceId)
    return emptyResult(hwmBefore)
  }

  const parsed = parseBiometricTxt(content)
  if (parsed.punches.length === 0) {
    await writeIngestionLog(db, deviceId, startedAt, 'success', {}, hwmBefore, hwmBefore, null)
    await updateIngestionHash(db, deviceId, fileHash)
    return emptyResult(hwmBefore)
  }

  const hwmDate = hwmBefore ? new Date(hwmBefore) : null
  const filteredPunches = hwmDate
    ? parsed.punches.filter((p) => {
        const ts = new Date(`${p.date}T${p.time.length === 5 ? `${p.time}:00` : p.time}`)
        return ts > hwmDate
      })
    : parsed.punches

  const empMap = await buildEmployeeMap(db)
  const deviceCode = (device.code as string) ?? 'UNKNOWN'
  let punchesNew = 0
  let punchesSkipped = 0
  const unknownCodes = new Set<string>()
  let maxPunchedAt = hwmDate

  for (const p of filteredPunches) {
    const employeeId = empMap.get(p.employeeCode.toUpperCase())
    if (!employeeId) {
      unknownCodes.add(p.employeeCode)
      continue
    }

    const idemKey = `${p.deviceCode ?? deviceCode}:${p.employeeCode}:${p.date}_${p.time.replace(/:/g, '')}`
    const punchedAt = new Date(`${p.date}T${p.time.length === 5 ? `${p.time}:00` : p.time}`)

    try {
      const result = await db
        .insert(attendancePunches)
        .values({
          employeeId,
          deviceId,
          punchedAt,
          punchType: p.punchType,
          source: 'import',
          idempotencyKey: idemKey,
        })
        .onConflictDoNothing()
        .returning({ id: attendancePunches.id })

      if (result.length > 0) {
        punchesNew++
      } else {
        punchesSkipped++
      }
    } catch {
      punchesSkipped++
    }

    if (!maxPunchedAt || punchedAt > maxPunchedAt) {
      maxPunchedAt = punchedAt
    }
  }

  const hwmAfter = maxPunchedAt?.toISOString() ?? hwmBefore
  const finishedAt = new Date()

  await db
    .update(attendanceIngestionState)
    .set({
      highWaterMark: maxPunchedAt,
      lastFileHash: fileHash,
      lastRunAt: finishedAt,
      lastSuccessAt: finishedAt,
      lastError: null,
      punchesIngested: sql`${attendanceIngestionState.punchesIngested} + ${punchesNew}`,
      updatedAt: finishedAt,
    })
    .where(eq(attendanceIngestionState.deviceId, deviceId))

  await writeIngestionLog(
    db,
    deviceId,
    startedAt,
    'success',
    {
      punchesFound: filteredPunches.length,
      punchesNew,
      punchesSkipped,
      unknownEmployees: unknownCodes.size,
    },
    hwmBefore,
    hwmAfter,
    null
  )

  return {
    punchesFound: filteredPunches.length,
    punchesNew,
    punchesSkipped,
    unknownEmployees: unknownCodes.size,
    highWaterBefore: hwmBefore,
    highWaterAfter: hwmAfter,
  }
}

async function runApiIngestion(
  db: AnyDb,
  device: Record<string, unknown>,
  state: Record<string, unknown> | null,
  startedAt: Date,
  hwmBefore: string | null
): Promise<IngestionResult> {
  const deviceId = device.id as string
  const sourceUrl = device.syncSourcePath as string | null
  if (!sourceUrl) {
    const msg = 'sync_source_path (URL) no configurado para este dispositivo.'
    await writeIngestionLog(db, deviceId, startedAt, 'error', {}, hwmBefore, hwmBefore, msg)
    return emptyResult(hwmBefore, msg)
  }

  const since = hwmBefore ?? new Date(0).toISOString()
  let body: string
  try {
    const res = await fetch(`${sourceUrl}?since=${encodeURIComponent(since)}`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    body = await res.text()
  } catch (err) {
    const msg = `API fetch failed: ${err instanceof Error ? err.message : err}`
    await writeIngestionLog(db, deviceId, startedAt, 'error', {}, hwmBefore, hwmBefore, msg)
    return emptyResult(hwmBefore, msg)
  }

  const parsed = parseBiometricTxt(body)
  const empMap = await buildEmployeeMap(db)
  const deviceCode = (device.code as string) ?? 'UNKNOWN'
  let punchesNew = 0
  let punchesSkipped = 0
  const unknownCodes = new Set<string>()
  let maxPunchedAt = hwmBefore ? new Date(hwmBefore) : null

  for (const p of parsed.punches) {
    const employeeId = empMap.get(p.employeeCode.toUpperCase())
    if (!employeeId) {
      unknownCodes.add(p.employeeCode)
      continue
    }

    const idemKey = `${p.deviceCode ?? deviceCode}:${p.employeeCode}:${p.date}_${p.time.replace(/:/g, '')}`
    const punchedAt = new Date(`${p.date}T${p.time.length === 5 ? `${p.time}:00` : p.time}`)

    try {
      const result = await db
        .insert(attendancePunches)
        .values({
          employeeId,
          deviceId,
          punchedAt,
          punchType: p.punchType,
          source: 'api',
          idempotencyKey: idemKey,
        })
        .onConflictDoNothing()
        .returning({ id: attendancePunches.id })
      if (result.length > 0) punchesNew++
      else punchesSkipped++
    } catch {
      punchesSkipped++
    }

    if (!maxPunchedAt || punchedAt > maxPunchedAt) maxPunchedAt = punchedAt
  }

  const hwmAfter = maxPunchedAt?.toISOString() ?? hwmBefore
  const finishedAt = new Date()

  await db
    .update(attendanceIngestionState)
    .set({
      highWaterMark: maxPunchedAt,
      lastRunAt: finishedAt,
      lastSuccessAt: finishedAt,
      lastError: null,
      punchesIngested: sql`${attendanceIngestionState.punchesIngested} + ${punchesNew}`,
      updatedAt: finishedAt,
    })
    .where(eq(attendanceIngestionState.deviceId, deviceId))

  await writeIngestionLog(
    db,
    deviceId,
    startedAt,
    'success',
    {
      punchesFound: parsed.punches.length,
      punchesNew,
      punchesSkipped,
      unknownEmployees: unknownCodes.size,
    },
    hwmBefore,
    hwmAfter,
    null
  )

  return {
    punchesFound: parsed.punches.length,
    punchesNew,
    punchesSkipped,
    unknownEmployees: unknownCodes.size,
    highWaterBefore: hwmBefore,
    highWaterAfter: hwmAfter,
  }
}

function emptyResult(hwm: string | null, error?: string): IngestionResult {
  return {
    punchesFound: 0,
    punchesNew: 0,
    punchesSkipped: 0,
    unknownEmployees: 0,
    highWaterBefore: hwm,
    highWaterAfter: hwm,
    error,
  }
}

async function writeIngestionLog(
  db: AnyDb,
  deviceId: string,
  startedAt: Date,
  status: string,
  stats: Partial<{
    punchesFound: number
    punchesNew: number
    punchesSkipped: number
    unknownEmployees: number
  }>,
  hwmBefore: string | null,
  hwmAfter: string | null,
  errorMessage: string | null
) {
  await db.insert(attendanceIngestionLog).values({
    deviceId,
    startedAt,
    finishedAt: new Date(),
    status,
    punchesFound: stats.punchesFound ?? 0,
    punchesNew: stats.punchesNew ?? 0,
    punchesSkipped: stats.punchesSkipped ?? 0,
    unknownEmployees: stats.unknownEmployees ?? 0,
    highWaterBefore: hwmBefore ? new Date(hwmBefore) : null,
    highWaterAfter: hwmAfter ? new Date(hwmAfter) : null,
    errorMessage,
  })
}

async function touchLastRun(db: AnyDb, deviceId: string) {
  const now = new Date()
  await db
    .update(attendanceIngestionState)
    .set({ lastRunAt: now, lastSuccessAt: now, lastError: null, updatedAt: now })
    .where(eq(attendanceIngestionState.deviceId, deviceId))
}

async function updateIngestionHash(db: AnyDb, deviceId: string, hash: string) {
  const now = new Date()
  await db
    .update(attendanceIngestionState)
    .set({
      lastFileHash: hash,
      lastRunAt: now,
      lastSuccessAt: now,
      lastError: null,
      updatedAt: now,
    })
    .where(eq(attendanceIngestionState.deviceId, deviceId))
}
