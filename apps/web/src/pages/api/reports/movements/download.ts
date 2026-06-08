import { renderToBuffer } from '@react-pdf/renderer'
import type { APIRoute } from 'astro'
import React from 'react'
import { MovementsPdf } from '../../../../lib/pdf/movements-pdf'
import { fetchMovementsReportData } from '../../../../lib/reports/movements-data'
import { resolveTenantSlugFromCookie } from '../../../../lib/tenant-slug'

/**
 * Decode the auth JWT (payload only) so the footer can stamp the
 * generator's name + email. Already validated upstream by every
 * protected route.
 */
function decodeJwtPayload(token: string): { name?: string; email?: string } | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const json = Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString(
      'utf8'
    )
    return JSON.parse(json) as { name?: string; email?: string }
  } catch {
    return null
  }
}

export const GET: APIRoute = async ({ url, cookies, redirect }) => {
  const authCookie = cookies.get('auth')?.value
  if (!authCookie) return redirect('/login')
  const tenantSlug = resolveTenantSlugFromCookie(authCookie)

  const sp = url.searchParams
  const filters = {
    year: sp.get('year'),
    from: sp.get('from'),
    to: sp.get('to'),
    typeId: sp.get('typeId'),
    subtypeId: sp.get('subtypeId'),
    typeName: sp.get('typeName'),
    subtypeName: sp.get('subtypeName'),
  }

  const result = await fetchMovementsReportData(filters, authCookie, tenantSlug)
  if (result.kind === 'unauthorized') return redirect('/login')
  if (result.kind === 'error') return new Response(result.message, { status: result.status })

  const jwt = decodeJwtPayload(authCookie)
  const generatedBy = jwt ? { name: jwt.name ?? null, email: jwt.email ?? null } : null

  const element = React.createElement(MovementsPdf, {
    company: result.data.company,
    filters: result.data.filters,
    rows: result.data.rows,
    generatedBy,
  })
  // biome-ignore lint/suspicious/noExplicitAny: library typing gap
  const buffer = await renderToBuffer(element as any)
  const pdfBytes = new Uint8Array(buffer)

  const yearLabel = filters.year ?? new Date().getFullYear()
  return new Response(pdfBytes as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="movimientos-${yearLabel}.pdf"`,
      'Content-Length': String(pdfBytes.byteLength),
    },
  })
}
