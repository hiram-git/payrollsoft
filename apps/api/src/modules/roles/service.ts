import {
  bumpPermissionsVersion,
  permissionsCatalog,
  roleInheritance,
  rolePermissions,
  roles,
  userRoles,
} from '@payroll/db'
/**
 * Tenant-scoped role management.
 *
 * All operations run against the tenant's own roles / role_permissions /
 * role_inheritance / user_roles tables. Permission codes are validated
 * against the central payroll_auth.permissions_catalog so a role can never
 * be granted an unknown permission.
 *
 * Whenever the permission graph for a role changes, every user holding
 * that role (directly or via inheritance) gets their permissions_version
 * bumped so live JWTs are forced through a refresh.
 */
import type { PermissionCode } from '@payroll/types'
import { and, eq, inArray, sql } from 'drizzle-orm'

// biome-ignore lint/suspicious/noExplicitAny: Drizzle generic
type AnyDb = any

export type RoleSummary = {
  id: string
  code: string
  name: string
  description: string | null
  isSystem: boolean
  createdAt: Date
  updatedAt: Date
}

export type RoleDetail = RoleSummary & {
  permissions: PermissionCode[]
  parentRoleIds: string[]
  childRoleIds: string[]
  userCount: number
}

export async function listRoles(db: AnyDb): Promise<RoleSummary[]> {
  return db.select().from(roles).orderBy(roles.code)
}

export async function getRole(db: AnyDb, id: string): Promise<RoleDetail | null> {
  const [role] = await db.select().from(roles).where(eq(roles.id, id)).limit(1)
  if (!role) return null

  const [perms, parents, children, userCountRow] = await Promise.all([
    db
      .select({ code: rolePermissions.permissionCode })
      .from(rolePermissions)
      .where(eq(rolePermissions.roleId, id)),
    db
      .select({ id: roleInheritance.parentRoleId })
      .from(roleInheritance)
      .where(eq(roleInheritance.childRoleId, id)),
    db
      .select({ id: roleInheritance.childRoleId })
      .from(roleInheritance)
      .where(eq(roleInheritance.parentRoleId, id)),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(userRoles)
      .where(eq(userRoles.roleId, id)),
  ])

  return {
    ...role,
    permissions: perms.map((p: { code: string }) => p.code) as PermissionCode[],
    parentRoleIds: parents.map((r: { id: string }) => r.id),
    childRoleIds: children.map((r: { id: string }) => r.id),
    userCount: userCountRow[0]?.count ?? 0,
  }
}

export type CreateRoleInput = {
  code: string
  name: string
  description?: string | null
}

export async function createRole(db: AnyDb, input: CreateRoleInput): Promise<RoleSummary> {
  const [row] = await db
    .insert(roles)
    .values({
      code: input.code,
      name: input.name,
      description: input.description ?? null,
      isSystem: false,
    })
    .returning()
  return row
}

export type UpdateRoleInput = {
  name?: string
  description?: string | null
}

export async function updateRole(
  db: AnyDb,
  id: string,
  input: UpdateRoleInput
): Promise<RoleSummary | null> {
  const [row] = await db
    .update(roles)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(roles.id, id))
    .returning()
  return row ?? null
}

/**
 * Returns true if the role was deleted, false if it was a system role
 * (which cannot be removed) or did not exist.
 */
export async function deleteRole(
  db: AnyDb,
  id: string
): Promise<'deleted' | 'system' | 'not_found'> {
  const [role] = await db.select().from(roles).where(eq(roles.id, id)).limit(1)
  if (!role) return 'not_found'
  if (role.isSystem) return 'system'

  // Bump everyone who held the role before we cascade them off.
  const holders = await db
    .select({ userId: userRoles.userId })
    .from(userRoles)
    .where(eq(userRoles.roleId, id))
  await bumpPermissionsVersion(
    db,
    holders.map((h: { userId: string }) => h.userId)
  )

  await db.delete(roles).where(eq(roles.id, id))
  return 'deleted'
}

/**
 * Validate the supplied codes against the master catalog. Returns the
 * subset of codes that exist; the caller can compare against the input
 * to surface unknown codes.
 */
async function filterKnownPermissions(
  db: AnyDb,
  codes: readonly string[]
): Promise<PermissionCode[]> {
  if (codes.length === 0) return []
  const rows = await db
    .select({ code: permissionsCatalog.code })
    .from(permissionsCatalog)
    .where(inArray(permissionsCatalog.code, codes as string[]))
  return rows.map((r: { code: string }) => r.code) as PermissionCode[]
}

export type SetRolePermissionsResult =
  | { ok: true; granted: PermissionCode[]; rejected: string[] }
  | { ok: false; error: 'not_found' }

export async function setRolePermissions(
  db: AnyDb,
  roleId: string,
  codes: readonly string[]
): Promise<SetRolePermissionsResult> {
  const [role] = await db.select().from(roles).where(eq(roles.id, roleId)).limit(1)
  if (!role) return { ok: false, error: 'not_found' }

  const known = await filterKnownPermissions(db, codes)
  const knownSet = new Set(known)
  const rejected = codes.filter((c) => !knownSet.has(c as PermissionCode))

  await db.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId))
  if (known.length > 0) {
    await db.insert(rolePermissions).values(known.map((code) => ({ roleId, permissionCode: code })))
  }

  await bumpHoldersFor(db, roleId)
  return { ok: true, granted: known, rejected }
}

export type SetRoleInheritanceResult =
  | { ok: true; parents: string[] }
  | { ok: false; error: 'not_found' | 'cycle' | 'self_loop' }

export async function setRoleInheritance(
  db: AnyDb,
  childRoleId: string,
  parentRoleIds: readonly string[]
): Promise<SetRoleInheritanceResult> {
  const [role] = await db.select().from(roles).where(eq(roles.id, childRoleId)).limit(1)
  if (!role) return { ok: false, error: 'not_found' }

  if (parentRoleIds.includes(childRoleId)) {
    return { ok: false, error: 'self_loop' }
  }

  // Cycle check: starting from each candidate parent, walk upwards through
  // role_inheritance and verify the child role is never reached.
  if (parentRoleIds.length > 0) {
    const ancestors = await db.execute(sql`
      WITH RECURSIVE ancestors AS (
        SELECT child_role_id, parent_role_id, 0 AS depth
          FROM role_inheritance
         WHERE child_role_id = ANY(${parentRoleIds as string[]}::uuid[])
        UNION
        SELECT a.child_role_id, ri.parent_role_id, a.depth + 1
          FROM role_inheritance ri
          JOIN ancestors a ON ri.child_role_id = a.parent_role_id
         WHERE a.depth < 10
      )
      SELECT 1 FROM ancestors WHERE parent_role_id = ${childRoleId}::uuid LIMIT 1
    `)
    if ((ancestors as unknown as Array<unknown>).length > 0) {
      return { ok: false, error: 'cycle' }
    }
  }

  await db.delete(roleInheritance).where(eq(roleInheritance.childRoleId, childRoleId))
  if (parentRoleIds.length > 0) {
    await db.insert(roleInheritance).values(
      parentRoleIds.map((parentRoleId) => ({
        parentRoleId,
        childRoleId,
      }))
    )
  }

  await bumpHoldersFor(db, childRoleId)
  return { ok: true, parents: parentRoleIds as string[] }
}

/**
 * Bump permissions_version for every user that holds `roleId` directly OR
 * holds a descendant role (since they inherit through the changed role).
 */
async function bumpHoldersFor(db: AnyDb, roleId: string): Promise<void> {
  const rows = await db.execute(sql`
    WITH RECURSIVE descendants AS (
      SELECT id FROM roles WHERE id = ${roleId}::uuid
      UNION
      SELECT ri.child_role_id
        FROM role_inheritance ri
        JOIN descendants d ON ri.parent_role_id = d.id
    )
    SELECT DISTINCT ur.user_id AS user_id
      FROM user_roles ur
      JOIN descendants d ON d.id = ur.role_id
  `)
  const userIds = (rows as unknown as Array<{ user_id: string }>).map((r) => r.user_id)
  await bumpPermissionsVersion(db, userIds)
}

/**
 * Atomically replace a user's role assignments. Returns the resulting list
 * of role ids assigned to the user.
 */
export async function setUserRoles(
  db: AnyDb,
  userId: string,
  roleIds: readonly string[]
): Promise<string[]> {
  // Validate every supplied role id exists in this tenant.
  const valid =
    roleIds.length === 0
      ? []
      : await db
          .select({ id: roles.id })
          .from(roles)
          .where(inArray(roles.id, roleIds as string[]))

  const validIds = valid.map((r: { id: string }) => r.id)

  await db.delete(userRoles).where(eq(userRoles.userId, userId))
  if (validIds.length > 0) {
    await db.insert(userRoles).values(validIds.map((roleId: string) => ({ userId, roleId })))
  }

  await bumpPermissionsVersion(db, [userId])
  return validIds
}

export async function listUserRoles(db: AnyDb, userId: string): Promise<RoleSummary[]> {
  return db
    .select({
      id: roles.id,
      code: roles.code,
      name: roles.name,
      description: roles.description,
      isSystem: roles.isSystem,
      createdAt: roles.createdAt,
      updatedAt: roles.updatedAt,
    })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .where(eq(userRoles.userId, userId))
    .orderBy(roles.code)
}

/** True if a tenant role with the given code already exists. */
export async function roleCodeExists(db: AnyDb, code: string, exceptId?: string): Promise<boolean> {
  const where = exceptId
    ? and(eq(roles.code, code), sql`${roles.id} <> ${exceptId}`)
    : eq(roles.code, code)
  const [row] = await db.select({ id: roles.id }).from(roles).where(where).limit(1)
  return !!row
}
