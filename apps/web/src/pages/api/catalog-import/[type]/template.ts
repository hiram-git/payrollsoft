/**
 * GET /api/catalog-import/:type/template
 *
 * Genera un .xlsx con la fila de headers y una fila de ejemplo
 * para el catálogo indicado.
 */
import type { APIRoute } from 'astro'
import * as XLSX from 'xlsx'
import { getIdentity } from '../../../../lib/auth'
import { getCatalogConfig } from '../../../../lib/catalog-import/config'

export const GET: APIRoute = async ({ params, cookies }) => {
  const identity = getIdentity(cookies)
  if (!identity) return new Response('Unauthorized', { status: 401 })

  const config = getCatalogConfig(params.type ?? '')
  if (!config) return new Response('Catálogo no reconocido', { status: 404 })

  const headers = [...config.required, ...config.optional].map((c) => c.label)
  const keys = [...config.required, ...config.optional].map((c) => c.key)
  const example = keys.map((k) => config.sampleRow[k] ?? '')

  const ws = XLSX.utils.aoa_to_sheet([headers, example])
  ws['!cols'] = headers.map((h) => ({ wch: Math.max(h.length + 4, 14) }))

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, config.label)

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
  const filename = `plantilla-${params.type}.xlsx`

  return new Response(buf as Buffer, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
