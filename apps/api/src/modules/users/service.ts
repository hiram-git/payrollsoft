/**
 * Tenant-scoped user management.
 *
 * Listing, creating and deactivating tenant users from the admin UI. Auth
 * itself stays in the auth module — this layer is for "who has an account
 * in this company" administration, on top of the existing users table.
 */
import { bumpPermissionsVersion, users } from '@payroll/db'
import { and, asc, eq, ilike, or, sql } from 'drizzle-orm'

// biome-ignore lint/suspicious/noExplicitAny: Drizzle generic
type AnyDb = any

export type UserSummary = {
  id: string
  email: string
  name: string
  role: string
  isActive: boolean
  isTenantAdmin: boolean
  permissionsVersion: number
  lastLoginAt: Date | null
  createdAt: Date
}

export async function listUsers(
  db: AnyDb,
  filters: { search?: string; isActive?: boolean } = {}
): Promise<UserSummary[]> {
  const conds = []
  if (filters.search) {
    const term = `%${filters.search}%`
    conds.push(or(ilike(users.email, term), ilike(users.name, term)))
  }
  if (filters.isActive !== undefined) {
    conds.push(eq(users.isActive, filters.isActive))
  }

  const where = conds.length > 0 ? and(...conds) : undefined
  return db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      isActive: users.isActive,
      isTenantAdmin: users.isTenantAdmin,
      permissionsVersion: users.permissionsVersion,
      lastLoginAt: users.lastLoginAt,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(where)
    .orderBy(asc(users.email))
}

export async function getUser(db: AnyDb, id: string): Promise<UserSummary | null> {
  const [row] = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      isActive: users.isActive,
      isTenantAdmin: users.isTenantAdmin,
      permissionsVersion: users.permissionsVersion,
      lastLoginAt: users.lastLoginAt,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.id, id))
    .limit(1)
  return row ?? null
}

export type CreateUserInput = {
  email: string
  name: string
  passwordHash: string
}

export type CreateUserResult = { ok: true; user: UserSummary } | { ok: false; error: 'email_taken' }

export async function createUser(db: AnyDb, input: CreateUserInput): Promise<CreateUserResult> {
  const email = input.email.trim().toLowerCase()

  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1)
  if (existing) return { ok: false, error: 'email_taken' }

  const [row] = await db
    .insert(users)
    .values({
      email,
      name: input.name,
      passwordHash: input.passwordHash,
      role: 'VIEWER',
      isActive: true,
      isTenantAdmin: false,
    })
    .returning({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      isActive: users.isActive,
      isTenantAdmin: users.isTenantAdmin,
      permissionsVersion: users.permissionsVersion,
      lastLoginAt: users.lastLoginAt,
      createdAt: users.createdAt,
    })

  return { ok: true, user: row }
}

export type UpdateUserInput = {
  name?: string
}

export async function updateUser(
  db: AnyDb,
  id: string,
  input: UpdateUserInput
): Promise<UserSummary | null> {
  const [row] = await db
    .update(users)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(users.id, id))
    .returning({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      isActive: users.isActive,
      isTenantAdmin: users.isTenantAdmin,
      permissionsVersion: users.permissionsVersion,
      lastLoginAt: users.lastLoginAt,
      createdAt: users.createdAt,
    })
  return row ?? null
}

export type DeactivateResult =
  | { ok: true; user: UserSummary }
  | { ok: false; error: 'not_found' | 'is_tenant_admin' }

/**
 * Soft-deactivate a user. The single tenant admin cannot be deactivated
 * through this endpoint — that has to go through the super-admin reset
 * flow so the tenant is never left without an owner.
 */
export async function deactivateUser(db: AnyDb, id: string): Promise<DeactivateResult> {
  const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1)
  if (!row) return { ok: false, error: 'not_found' }
  if (row.isTenantAdmin) return { ok: false, error: 'is_tenant_admin' }

  const [updated] = await db
    .update(users)
    .set({
      isActive: false,
      permissionsVersion: sql`${users.permissionsVersion} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(users.id, id))
    .returning({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      isActive: users.isActive,
      isTenantAdmin: users.isTenantAdmin,
      permissionsVersion: users.permissionsVersion,
      lastLoginAt: users.lastLoginAt,
      createdAt: users.createdAt,
    })

  return { ok: true, user: updated }
}

/**
 * Reactivate a previously-deactivated user. Bumps permissions_version so any
 * stale token is invalidated.
 */
export async function reactivateUser(db: AnyDb, id: string): Promise<UserSummary | null> {
  const [updated] = await db
    .update(users)
    .set({
      isActive: true,
      permissionsVersion: sql`${users.permissionsVersion} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(users.id, id))
    .returning({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      isActive: users.isActive,
      isTenantAdmin: users.isTenantAdmin,
      permissionsVersion: users.permissionsVersion,
      lastLoginAt: users.lastLoginAt,
      createdAt: users.createdAt,
    })
  return updated ?? null
}

/**
 * Force-rotate a user's password (bumps permissions_version too).
 * Used by tenant admins to recover an account when the user is locked out.
 */
export async function setUserPassword(
  db: AnyDb,
  id: string,
  passwordHash: string
): Promise<boolean> {
  const result = await db
    .update(users)
    .set({
      passwordHash,
      updatedAt: new Date(),
    })
    .where(eq(users.id, id))
    .returning({ id: users.id })

  if (result.length === 0) return false
  await bumpPermissionsVersion(db, [id])
  return true
}
