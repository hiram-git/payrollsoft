/**
 * Effective-permissions resolver.
 *
 * A user inherits permissions from every role they're assigned, plus every
 * role those roles inherit from (transitively). The resolution runs as a
 * single recursive CTE so we never round-trip the graph: O(1) queries per
 * login regardless of how deep the inheritance is.
 *
 * Cycles in role_inheritance are blocked at insert time by the application
 * layer; the CTE is also guarded by a depth limit (10) so a misconfigured
 * graph cannot DoS the login endpoint.
 */
import type { PermissionCode } from '@payroll/types'
import { eq, inArray, sql } from 'drizzle-orm'
import type { createPublicDb, createTenantDb } from './client'
import { users } from './schema/users'

type Db = ReturnType<typeof createTenantDb> | ReturnType<typeof createPublicDb>

const MAX_INHERITANCE_DEPTH = 10

export type EffectivePermissions = {
  permissions: PermissionCode[]
  roles: string[]
  permissionsVersion: number
}

/**
 * Compute the effective permissions and role codes for a user inside the
 * tenant schema currently selected by the db connection's search_path.
 */
export async function getEffectivePermissions(
  db: Db,
  userId: string
): Promise<EffectivePermissions> {
  const [userRow] = await db
    .select({ id: users.id, permissionsVersion: users.permissionsVersion })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)

  if (!userRow) {
    return { permissions: [], roles: [], permissionsVersion: 0 }
  }

  // The CTE walks role_inheritance starting from the user's directly-assigned
  // roles and accumulates every reachable parent. We then join the closure
  // against role_permissions to emit the unique permission codes.
  const rows = await db.execute(sql`
    WITH RECURSIVE
      direct AS (
        SELECT ur.role_id, 0 AS depth
          FROM user_roles ur
         WHERE ur.user_id = ${userId}
      ),
      closure AS (
        SELECT role_id, depth FROM direct
        UNION
        SELECT ri.parent_role_id, c.depth + 1
          FROM role_inheritance ri
          JOIN closure c ON ri.child_role_id = c.role_id
         WHERE c.depth < ${MAX_INHERITANCE_DEPTH}
      )
    SELECT
      (SELECT array_agg(DISTINCT r.code)
         FROM closure c
         JOIN roles r ON r.id = c.role_id) AS roles,
      (SELECT array_agg(DISTINCT rp.permission_code)
         FROM closure c
         JOIN role_permissions rp ON rp.role_id = c.role_id) AS permissions
  `)

  const row = (
    rows as unknown as Array<{ roles: string[] | null; permissions: string[] | null }>
  )[0]
  const roles = row?.roles ?? []
  const permissions = (row?.permissions ?? []) as PermissionCode[]

  return {
    permissions,
    roles,
    permissionsVersion: userRow.permissionsVersion,
  }
}

/**
 * Increment users.permissions_version so any in-flight JWTs are invalidated
 * the next time they're used. Call this after any of:
 *   - changing a user's role assignments
 *   - editing role_permissions for a role they hold
 *   - adding/removing a parent in role_inheritance for those roles
 */
export async function bumpPermissionsVersion(db: Db, userIds: string[]): Promise<void> {
  if (userIds.length === 0) return
  // Use the typed query builder instead of raw `ANY($1::uuid[])` — postgres.js
  // serialises a JS array into a PG array literal, but Drizzle's sql tag
  // wraps it in a way the `::uuid[]` cast doesn't always accept, surfacing
  // as an opaque 500 from /users/:id/roles.
  await db
    .update(users)
    .set({
      permissionsVersion: sql`${users.permissionsVersion} + 1`,
      updatedAt: new Date(),
    })
    .where(inArray(users.id, userIds))
}
