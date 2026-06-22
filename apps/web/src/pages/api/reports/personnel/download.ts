import type { APIRoute } from 'astro'
import { fetchPersonnelReportData, personnelFileSlug } from '../../../../lib/reports/personnel-data'
import { renderPersonnelPdfBuffer } from '../../../../lib/reports/personnel-pdf-renderer'
import { getReportStorage, isPersistentMode } from '../../../../lib/reports/storage'
import { resolveTenantSlugFromCookie } from '../../../../lib/tenant-slug'

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'

/**
 * Decode the auth JWT (payload only) so we can stamp the generator
 * onto the PDF footer. The payload was already validated upstream by
 * every protected route — we just trust the same fields the topbar
 * already reads.
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

/**
 * Stream a fresh personnel-listing PDF, scoped by the navbar's active
 * payroll type. Always renders live (no persistence) — the listing is
 * cheap to compute and operators expect it to reflect any change to
 * the employee list immediately.
 *
 * Query params:
 *   payrollTypeId   — explicit override (defaults to the topbar cookie).
 *   payrollTypeName — display name for the PDF chip; we look it up
 *                     server-side when the cookie supplies the id but
 *                     no name was passed.
 */
export const GET: APIRoute = async ({ cookies, url, redirect }) => {
  const authCookie = cookies.get('auth')?.value
  if (!authCookie) return redirect('/login')
  const TENANT = resolveTenantSlugFromCookie(authCookie)

  const cookieTypeId = cookies.get('payroll.activeTypeId')?.value ?? null
  const queryTypeId = url.searchParams.get('payrollTypeId')
  const payrollTypeId = queryTypeId ?? cookieTypeId
  let payrollTypeName = url.searchParams.get('payrollTypeName')

  // Resolve type name if we only have the id. The /concepts/config
  // endpoint backs the topbar selector so the name is guaranteed to
  // be in sync with what the user sees.
  if (payrollTypeId && !payrollTypeName) {
    try {
      const res = await fetch(`${API_URL}/concepts/config`, {
        headers: { Cookie: `auth=${authCookie}`, 'X-Tenant': TENANT },
      })
      if (res.ok) {
        const json = (await res.json()) as {
          data?: { payrollTypes?: { id: string; name: string }[] }
        }
        const match = json.data?.payrollTypes?.find((t) => t.id === payrollTypeId)
        payrollTypeName = match?.name ?? null
      }
    } catch {
      // best-effort lookup; the chip just stays empty if it fails
    }
  }

  // Resolver el modo de almacenamiento del tenant para decidir si
  // cacheamos el PDF entre descargas. Para persistent modes intentamos
  // primero leer el objeto guardado; si está, lo servimos al instante.
  let payrollReportMode: string | null = null
  try {
    const cRes = await fetch(`${API_URL}/company`, {
      headers: { Cookie: `auth=${authCookie}`, 'X-Tenant': TENANT },
    })
    if (cRes.ok) {
      const cj = (await cRes.json()) as {
        data: { payrollReportMode?: string | null } | null
      }
      payrollReportMode = cj.data?.payrollReportMode ?? null
    }
  } catch {
    /* default on_demand */
  }

  // ── Filtros del reporte (situación / discapacidad propia / familiar) ──
  const sitParam = url.searchParams.get('situacion')
  const situacion: 'active' | 'inactive' | 'all' =
    sitParam === 'inactive' ? 'inactive' : sitParam === 'all' ? 'all' : 'active'
  const hasOwnDisability = url.searchParams.get('hasOwnDisability') === 'true'
  const hasFamilyDisability = url.searchParams.get('hasFamilyDisability') === 'true'
  const includeDependents = url.searchParams.get('dependents') === 'true'

  // Cualquier filtro distinto al default (activos + tipo) hace único el
  // resultado, así que saltamos el cache persistente — de lo contrario un
  // reporte filtrado serviría los bytes cacheados sin filtrar.
  const hasExtraFilters =
    situacion !== 'active' || hasOwnDisability || hasFamilyDisability || includeDependents

  const storage =
    !hasExtraFilters && isPersistentMode(payrollReportMode)
      ? getReportStorage(payrollReportMode)
      : null
  const storageKey = `reports/personnel/${TENANT}/${payrollTypeId ?? 'all'}.pdf`

  let pdfBytes: Uint8Array | null = null
  if (storage) {
    try {
      pdfBytes = await storage.get(storageKey)
    } catch (err) {
      console.error('Personnel PDF storage read error:', err)
      pdfBytes = null
    }
  }

  if (!pdfBytes) {
    const fetchResult = await fetchPersonnelReportData(authCookie, {
      payrollTypeId,
      payrollTypeName,
      situacion,
      hasOwnDisability,
      hasFamilyDisability,
      includeDependents,
    })
    if (fetchResult.kind === 'unauthorized') return redirect('/login')
    if (fetchResult.kind === 'error') {
      return new Response(fetchResult.message, { status: fetchResult.status })
    }

    const jwt = decodeJwtPayload(authCookie)
    const generatedBy = jwt ? { name: jwt.name ?? null, email: jwt.email ?? null } : null

    try {
      pdfBytes = await renderPersonnelPdfBuffer({ ...fetchResult.data, generatedBy })
    } catch (err) {
      console.error('Personnel PDF render error:', err)
      return new Response('Error al renderizar el PDF', { status: 500 })
    }

    if (storage) {
      try {
        await storage.put({ key: storageKey, bytes: pdfBytes, contentType: 'application/pdf' })
      } catch (err) {
        // No-op: si el upload falla igual servimos los bytes recién
        // renderizados. El operador verá el error en logs.
        console.error('Personnel PDF storage upload error:', err)
      }
    }
  }

  const slug = personnelFileSlug(payrollTypeName ?? 'todos')
  const filename = `personal-${slug}.pdf`
  // BodyInit accepts Uint8Array at runtime; the cast silences a TS lib
  // mismatch between @types/node and the web `Response` constructor.
  return new Response(pdfBytes as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(pdfBytes.byteLength),
    },
  })
}
