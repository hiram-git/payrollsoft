import { createHash, randomBytes } from 'node:crypto'
/**
 * Service layer del registro unificado de dispositivos de marcación.
 *
 * Operaciones: CRUD de dispositivos, registro de eventos,
 * generación de token API para dispositivos con conexión 'api'.
 */
import { attendanceDeviceEvents, attendanceDevices } from '@payroll/db'
import { desc, eq } from 'drizzle-orm'

// biome-ignore lint/suspicious/noExplicitAny: drizzle generic
type AnyDb = any

export async function listDevices(db: AnyDb) {
  return db
    .select()
    .from(attendanceDevices)
    .orderBy(attendanceDevices.deviceType, attendanceDevices.name)
}

export async function getDevice(db: AnyDb, id: string) {
  const [row] = await db
    .select()
    .from(attendanceDevices)
    .where(eq(attendanceDevices.id, id))
    .limit(1)
  return row ?? null
}

export type CreateDeviceInput = {
  code: string
  name: string
  deviceType: string
  connectionMethod: string
  location?: string | null
  ipAddress?: string | null
  latitude?: string | null
  longitude?: string | null
  serialNumber?: string | null
  manufacturer?: string | null
  model?: string | null
  syncSourcePath?: string | null
}

/**
 * Crea un dispositivo. Si el connectionMethod es 'api', genera un
 * token de autenticación y devuelve el token en claro UNA sola vez
 * (se almacena solo el hash SHA-256).
 */
export async function createDevice(
  db: AnyDb,
  input: CreateDeviceInput
): Promise<{ id: string; apiToken: string | null }> {
  let apiTokenHash: string | null = null
  let apiToken: string | null = null

  if (input.connectionMethod === 'api' || input.connectionMethod === 'webhook') {
    const raw = randomBytes(32).toString('hex')
    apiTokenHash = createHash('sha256').update(raw).digest('hex')
    apiToken = raw
  }

  const [row] = await db
    .insert(attendanceDevices)
    .values({
      code: input.code.trim().toUpperCase(),
      name: input.name.trim(),
      deviceType: input.deviceType,
      connectionMethod: input.connectionMethod,
      location: input.location?.trim() || null,
      ipAddress: input.ipAddress?.trim() || null,
      latitude: input.latitude?.trim() || null,
      longitude: input.longitude?.trim() || null,
      serialNumber: input.serialNumber?.trim() || null,
      manufacturer: input.manufacturer?.trim() || null,
      model: input.model?.trim() || null,
      syncSourcePath: input.syncSourcePath?.trim() || null,
      apiTokenHash,
    })
    .returning({ id: attendanceDevices.id })

  return { id: row.id as string, apiToken }
}

export type UpdateDeviceInput = {
  name?: string
  location?: string | null
  ipAddress?: string | null
  latitude?: string | null
  longitude?: string | null
  serialNumber?: string | null
  manufacturer?: string | null
  model?: string | null
  syncSourcePath?: string | null
  status?: string
  isActive?: number
}

export async function updateDevice(db: AnyDb, id: string, input: UpdateDeviceInput) {
  const set: Record<string, unknown> = { updatedAt: new Date() }
  if (input.name !== undefined) set.name = input.name.trim()
  if (input.location !== undefined) set.location = input.location?.trim() || null
  if (input.ipAddress !== undefined) set.ipAddress = input.ipAddress?.trim() || null
  if (input.latitude !== undefined) set.latitude = input.latitude?.trim() || null
  if (input.longitude !== undefined) set.longitude = input.longitude?.trim() || null
  if (input.serialNumber !== undefined) set.serialNumber = input.serialNumber?.trim() || null
  if (input.manufacturer !== undefined) set.manufacturer = input.manufacturer?.trim() || null
  if (input.model !== undefined) set.model = input.model?.trim() || null
  if (input.syncSourcePath !== undefined) set.syncSourcePath = input.syncSourcePath?.trim() || null
  if (input.status !== undefined) set.status = input.status
  if (input.isActive !== undefined) set.isActive = input.isActive

  const res = await db
    .update(attendanceDevices)
    .set(set)
    .where(eq(attendanceDevices.id, id))
    .returning()
  return res[0] ?? null
}

export async function rotateDeviceToken(
  db: AnyDb,
  id: string
): Promise<{ apiToken: string } | null> {
  const device = await getDevice(db, id)
  if (!device) return null

  const raw = randomBytes(32).toString('hex')
  const hash = createHash('sha256').update(raw).digest('hex')

  await db
    .update(attendanceDevices)
    .set({ apiTokenHash: hash, updatedAt: new Date() })
    .where(eq(attendanceDevices.id, id))

  await db.insert(attendanceDeviceEvents).values({
    deviceId: id,
    kind: 'token_rotated',
    message: 'Token API rotado',
  })

  return { apiToken: raw }
}

export async function recordDeviceEvent(
  db: AnyDb,
  deviceId: string,
  kind: string,
  message?: string,
  payload?: Record<string, unknown>
) {
  await db.insert(attendanceDeviceEvents).values({
    deviceId,
    kind,
    message: message ?? null,
    payload: payload ?? {},
  })
  await db
    .update(attendanceDevices)
    .set({ lastSeenAt: new Date(), updatedAt: new Date() })
    .where(eq(attendanceDevices.id, deviceId))
}

export async function listDeviceEvents(db: AnyDb, deviceId: string, limit = 50) {
  return db
    .select()
    .from(attendanceDeviceEvents)
    .where(eq(attendanceDeviceEvents.deviceId, deviceId))
    .orderBy(desc(attendanceDeviceEvents.createdAt))
    .limit(Math.min(limit, 200))
}
