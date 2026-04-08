import { createPublicDb, createTenantDb } from '@payroll/db'
import { env } from './env'

export const publicDb = createPublicDb(env.DATABASE_URL)

export function getTenantDb(tenantSlug: string) {
  return createTenantDb(tenantSlug, env.DATABASE_URL)
}
