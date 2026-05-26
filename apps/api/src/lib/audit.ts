import { auditLog } from '@payroll/db'

// biome-ignore lint/suspicious/noExplicitAny: drizzle generic
type AnyDb = any

export type AuditEntry = {
  userId?: string | null
  userName?: string | null
  action: string
  entity: string
  entityId?: string | null
  changes?: Record<string, unknown>
}

export async function writeAuditLog(db: AnyDb, entry: AuditEntry): Promise<void> {
  try {
    await db.insert(auditLog).values({
      userId: entry.userId ?? null,
      userName: entry.userName ?? null,
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId ?? null,
      changes: entry.changes ?? {},
    })
  } catch {}
}
