import { Elysia } from 'elysia'
import { getTenantDb, publicDb } from '../config/db'

export const tenantPlugin = new Elysia({ name: 'tenant' }).derive(
  { as: 'global' },
  ({ headers }) => {
    // Resolve tenant slug from X-Tenant header or subdomain
    const tenantHeader = headers['x-tenant']
    const host = headers.host ?? ''
    const subdomain = host.split('.')[0]

    const isLocalhost = subdomain === 'localhost' || subdomain === '127'
    const tenantSlug = tenantHeader ?? (!isLocalhost ? subdomain : undefined)

    return {
      tenantSlug,
      db: tenantSlug ? getTenantDb(tenantSlug) : publicDb,
    }
  }
)
