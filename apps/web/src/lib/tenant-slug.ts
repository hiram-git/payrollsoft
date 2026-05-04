/**
 * Resolve the active tenant slug from the auth cookie.
 *
 * Used by every page and API proxy that forwards requests to the API
 * with an `X-Tenant` header. The slug lives inside the JWT payload as
 * `tenantSlug` (Phase 3.3); this helper decodes the JWT WITHOUT
 * verifying the signature, since the API re-verifies on every request.
 *
 * Returns 'demo' when the cookie is missing or malformed — any
 * authenticated user always has tenantSlug set, so falling back to
 * 'demo' only matters for pre-RBAC tokens lingering during deploys.
 */
export function resolveTenantSlugFromCookie(rawJwt: string | undefined): string {
  if (!rawJwt) return 'demo'
  const parts = rawJwt.split('.')
  if (parts.length !== 3) return 'demo'
  try {
    const payload = JSON.parse(
      Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
    ) as { tenantSlug?: string }
    return payload.tenantSlug ?? 'demo'
  } catch {
    return 'demo'
  }
}
