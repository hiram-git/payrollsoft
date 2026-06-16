import type { APIRoute } from 'astro'
import * as XLSX from 'xlsx'
import { getIdentity } from '../../../../lib/auth'

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'

type CatalogRow = { id: string; code: string | null; name: string | null }

/**
 * Devuelve un archivo .xlsx con la cabecera de columnas esperadas por
 * el importador y una fila de ejemplo, más una hoja "Referencias" con
 * los catálogos vigentes (cargos, funciones, departamentos, posiciones
 * y partidas) por código — para que el usuario llene la plantilla con
 * valores válidos y no falle la importación.
 *
 * Las celdas de fecha se escriben como Date para que Excel las muestre
 * con formato fecha en vez de un serial numérico.
 */
export const GET: APIRoute = async ({ cookies }) => {
  const identity = getIdentity(cookies)
  if (!identity) return new Response('Unauthorized', { status: 401 })

  const headers = [
    'code',
    'firstName',
    'lastName',
    'idNumber',
    'hireDate',
    'baseSalary',
    'email',
    'phone',
    'socialSecurityNumber',
    'cargoCode',
    'funcionCode',
    'departamentoCode',
    'positionCode',
    'payFrequency',
  ]

  const exampleRow: Record<string, unknown> = {
    code: 'E001',
    firstName: 'María',
    lastName: 'Pérez',
    idNumber: '8-123-456',
    hireDate: new Date('2026-01-15'),
    baseSalary: 850.0,
    email: 'maria.perez@empresa.com',
    phone: '6000-0000',
    socialSecurityNumber: '1234567',
    cargoCode: 'GERENTE',
    funcionCode: '',
    departamentoCode: 'VENTAS',
    positionCode: '',
    payFrequency: 'biweekly',
  }

  const ws = XLSX.utils.json_to_sheet([exampleRow], { header: headers })
  // Anchos cómodos para que el usuario lea sin tener que redimensionar.
  ws['!cols'] = headers.map((h) => ({
    wch: Math.max(h.length + 2, 14),
  }))

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Empleados')

  // ── Hoja "Referencias": catálogos vigentes por código ──────────────────────
  // El importador resuelve cargo/función/departamento/posición por CÓDIGO, así
  // que listamos los códigos válidos. Las partidas van como referencia (cada
  // posición ya trae su partida asociada). Si algún catálogo no responde,
  // degradamos: la plantilla se entrega igual sin esa sección.
  const reqHeaders = { Cookie: `auth=${identity.raw}`, 'X-Tenant': identity.tenantSlug ?? 'demo' }
  async function fetchCatalog(path: string): Promise<CatalogRow[]> {
    try {
      const res = await fetch(`${API_URL}${path}`, { headers: reqHeaders })
      if (!res.ok) return []
      const json = (await res.json()) as { data?: CatalogRow[] }
      return json.data ?? []
    } catch {
      return []
    }
  }
  const [cargos, funciones, departamentos, posiciones, partidas] = await Promise.all([
    fetchCatalog('/job-titles'),
    fetchCatalog('/job-functions'),
    fetchCatalog('/departments'),
    fetchCatalog('/positions?isActive=true'),
    fetchCatalog('/budget-items'),
  ])

  const refRows: (string | null)[][] = [['CATÁLOGO', 'CÓDIGO', 'NOMBRE']]
  const pushCatalog = (label: string, rows: CatalogRow[]) => {
    for (const r of rows) refRows.push([label, r.code ?? '', r.name ?? ''])
  }
  pushCatalog('CARGO', cargos)
  pushCatalog('FUNCIÓN', funciones)
  pushCatalog('DEPARTAMENTO', departamentos)
  pushCatalog('POSICIÓN', posiciones)
  pushCatalog('PARTIDA', partidas)

  if (refRows.length > 1) {
    const wsRef = XLSX.utils.aoa_to_sheet(refRows)
    wsRef['!cols'] = [{ wch: 16 }, { wch: 22 }, { wch: 48 }]
    XLSX.utils.book_append_sheet(wb, wsRef, 'Referencias')
  }

  const buffer: Buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })

  return new Response(buffer as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="plantilla-empleados.xlsx"',
      'Content-Length': String(buffer.byteLength),
    },
  })
}
