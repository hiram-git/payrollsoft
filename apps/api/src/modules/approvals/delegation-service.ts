import { approvalDelegations, users } from '@payroll/db'
import { and, desc, eq, gte, lte } from 'drizzle-orm'

// biome-ignore lint/suspicious/noExplicitAny: Drizzle db instance
type AnyDb = any

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * Resolve who should act on `delegatorUserId`'s approvals on `date`.
 *
 * If an active delegation covers the date, returns the delegate; otherwise
 * the original delegator. This is identity substitution for ONE approval
 * step, not a multi-level chain. If several delegations overlap, the most
 * recently created one wins.
 */
export async function resolveApprover(
  db: AnyDb,
  delegatorUserId: string,
  date: string = today()
): Promise<string> {
  const [row] = await db
    .select({ delegateUserId: approvalDelegations.delegateUserId })
    .from(approvalDelegations)
    .where(
      and(
        eq(approvalDelegations.delegatorUserId, delegatorUserId),
        lte(approvalDelegations.validFrom, date),
        gte(approvalDelegations.validTo, date)
      )
    )
    .orderBy(desc(approvalDelegations.createdAt))
    .limit(1)
  return row?.delegateUserId ?? delegatorUserId
}

export async function createDelegation(
  db: AnyDb,
  input: {
    delegatorUserId: string
    delegateUserId: string
    validFrom: string
    validTo: string
    reason?: string | null
    createdBy?: string
  }
): Promise<{ success: true; id: string } | { success: false; error: string }> {
  if (input.delegatorUserId === input.delegateUserId) {
    return { success: false, error: 'El delegado debe ser distinto del delegante.' }
  }
  if (input.validTo < input.validFrom) {
    return { success: false, error: 'La fecha fin no puede ser anterior a la fecha inicio.' }
  }
  const [row] = await db
    .insert(approvalDelegations)
    .values({
      delegatorUserId: input.delegatorUserId,
      delegateUserId: input.delegateUserId,
      validFrom: input.validFrom,
      validTo: input.validTo,
      reason: input.reason ?? null,
      createdBy: input.createdBy ?? null,
    })
    .returning({ id: approvalDelegations.id })
  return { success: true, id: row.id }
}

/**
 * List delegations, optionally filtered to a delegator and/or only those
 * active today. Joins user names for display.
 */
export async function listDelegations(
  db: AnyDb,
  opts: { delegatorUserId?: string; activeOnly?: boolean } = {}
) {
  const conditions = []
  if (opts.delegatorUserId) {
    conditions.push(eq(approvalDelegations.delegatorUserId, opts.delegatorUserId))
  }
  if (opts.activeOnly) {
    const d = today()
    conditions.push(lte(approvalDelegations.validFrom, d))
    conditions.push(gte(approvalDelegations.validTo, d))
  }

  const delegator = users
  const rows = await db
    .select({
      id: approvalDelegations.id,
      delegatorUserId: approvalDelegations.delegatorUserId,
      delegateUserId: approvalDelegations.delegateUserId,
      validFrom: approvalDelegations.validFrom,
      validTo: approvalDelegations.validTo,
      reason: approvalDelegations.reason,
      createdAt: approvalDelegations.createdAt,
      delegatorName: delegator.name,
    })
    .from(approvalDelegations)
    .leftJoin(delegator, eq(approvalDelegations.delegatorUserId, delegator.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(approvalDelegations.createdAt))

  // Resolve delegate names in a second pass (self-join aliasing is awkward
  // with the query builder; the set is small).
  const delegateIds = [...new Set(rows.map((r: { delegateUserId: string }) => r.delegateUserId))]
  const nameById = new Map<string, string>()
  if (delegateIds.length > 0) {
    const names = await db.select({ id: users.id, name: users.name }).from(users)
    for (const u of names as { id: string; name: string }[]) nameById.set(u.id, u.name)
  }

  return rows.map((r: Record<string, unknown>) => ({
    ...r,
    delegateName: nameById.get(r.delegateUserId as string) ?? null,
  }))
}

/**
 * End a delegation early by setting its valid_to to yesterday (so it no
 * longer covers today), preserving the record for audit. If it had not
 * started yet, delete it instead.
 */
export async function endDelegation(
  db: AnyDb,
  id: string
): Promise<{ success: true } | { success: false; error: string }> {
  const [row] = await db
    .select()
    .from(approvalDelegations)
    .where(eq(approvalDelegations.id, id))
    .limit(1)
  if (!row) return { success: false, error: 'Delegación no encontrada.' }

  const d = today()
  if ((row.validFrom as string) > d) {
    await db.delete(approvalDelegations).where(eq(approvalDelegations.id, id))
    return { success: true }
  }
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
  await db
    .update(approvalDelegations)
    .set({ validTo: yesterday })
    .where(eq(approvalDelegations.id, id))
  return { success: true }
}
