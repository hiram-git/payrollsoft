import { createHash } from 'node:crypto'
import { attendanceDevices, attendancePunches, employees } from '@payroll/db'
import type { ConnectionMethod } from '@payroll/types'
import { CONNECTION_TO_SOURCE } from '@payroll/types'
import { eq, sql } from 'drizzle-orm'

// biome-ignore lint/suspicious/noExplicitAny: drizzle generic
type AnyDb = any

export type CreatePunchInput = {
  employeeId: string
  punchType: number
  punchedAt?: string
  deviceId?: string
  source: string
  idempotencyKey?: string
}

export async function createPunch(db: AnyDb, input: CreatePunchInput) {
  const punchedAt = input.punchedAt ? new Date(input.punchedAt) : new Date()
  const dateStr = punchedAt.toISOString().slice(0, 10).replace(/-/g, '')
  const timeStr = punchedAt.toISOString().slice(11, 19).replace(/:/g, '')

  const idemKey =
    input.idempotencyKey ?? `${input.source}:${input.employeeId.slice(0, 8)}:${dateStr}_${timeStr}`

  const [result] = await db
    .insert(attendancePunches)
    .values({
      employeeId: input.employeeId,
      deviceId: input.deviceId ?? null,
      punchedAt,
      punchType: input.punchType,
      source: input.source,
      idempotencyKey: idemKey,
    })
    .onConflictDoNothing()
    .returning({ id: attendancePunches.id })

  if (!result) {
    return { created: false, reason: 'duplicate' }
  }
  return { created: true, id: result.id }
}

export async function resolveDeviceByToken(
  db: AnyDb,
  token: string
): Promise<{ id: string; code: string; connectionMethod: string } | null> {
  const hash = createHash('sha256').update(token).digest('hex')
  const [device] = await db
    .select({
      id: attendanceDevices.id,
      code: attendanceDevices.code,
      connectionMethod: attendanceDevices.connectionMethod,
    })
    .from(attendanceDevices)
    .where(eq(attendanceDevices.apiTokenHash, hash))
    .limit(1)
  return device ?? null
}

export async function validateEmployeeExists(db: AnyDb, employeeId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: employees.id })
    .from(employees)
    .where(eq(employees.id, employeeId))
    .limit(1)
  return !!row
}

export function sourceForConnection(method: string): string {
  return CONNECTION_TO_SOURCE[method as ConnectionMethod] ?? method
}
