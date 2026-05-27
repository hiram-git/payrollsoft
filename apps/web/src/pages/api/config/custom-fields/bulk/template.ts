import type { APIRoute } from 'astro'
import * as XLSX from 'xlsx'
import { getIdentity } from '../../../../../lib/auth'

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000'

type CustomFieldDef = {
  id: string
  code: string
  name: string
  fieldType: 'text' | 'integer' | 'float' | 'date'
  isActive: boolean
}
type Employee = {
  id: string
  code: string
  firstName: string
  lastName: string
  isActive: boolean
  customFields?: Record<string, unknown>
}

/**
 * Genera un .xlsx con:
 *   - hoja "Valores": una fila por empleado activo con columnas
 *     `code` + `nombre` (informativa) + una columna por cada campo
 *     adicional activo, prellenada con el valor actual del jsonb.
 *
 * El operador edita los valores que necesite, sube el archivo en
 * /config/custom-fields/bulk y el proxy hace PUT por cada fila.
 */
export const GET: APIRoute = async ({ cookies }) => {
  const identity = getIdentity(cookies)
  if (!identity) return new Response('Unauthorized', { status: 401 })
  const tenant = identity.tenantSlug ?? 'demo'
  const headers = { Cookie: `auth=${identity.raw}`, 'X-Tenant': tenant }

  let defs: CustomFieldDef[] = []
  let employees: Employee[] = []
  try {
    const [defsRes, empRes] = await Promise.all([
      fetch(`${API_URL}/custom-fields`, { headers }),
      fetch(`${API_URL}/employees?limit=2000`, { headers }),
    ])
    if (defsRes.ok) {
      defs = ((await defsRes.json()) as { data: CustomFieldDef[] }).data ?? []
    }
    if (empRes.ok) {
      employees = ((await empRes.json()) as { data: Employee[] }).data ?? []
    }
  } catch (err) {
    return new Response(
      `Error cargando datos: ${err instanceof Error ? err.message : String(err)}`,
      { status: 502 }
    )
  }

  const activeDefs = defs.filter((d) => d.isActive)
  const activeEmployees = employees.filter((e) => e.isActive)

  // Cabecera: code + nombre + un campo por definición (en su sortOrder).
  const headerRow = ['code', 'nombre', ...activeDefs.map((d) => d.code)]
  const rows = activeEmployees.map((e) => {
    const row: Record<string, unknown> = {
      code: e.code,
      nombre: `${e.lastName ?? ''}, ${e.firstName ?? ''}`.trim(),
    }
    for (const def of activeDefs) {
      const v = e.customFields?.[def.code]
      row[def.code] =
        v == null
          ? ''
          : v instanceof Date
            ? v.toISOString().slice(0, 10)
            : typeof v === 'object'
              ? JSON.stringify(v)
              : v
    }
    return row
  })

  const ws = XLSX.utils.json_to_sheet(rows, { header: headerRow })
  ws['!cols'] = headerRow.map((h) => ({ wch: Math.max(h.length + 2, 16) }))

  // Segunda hoja: referencia con tipo de cada campo, para que el
  // operador sepa qué formato escribir en cada columna.
  const refRows = activeDefs.map((d) => ({
    code: d.code,
    nombre: d.name,
    tipo:
      d.fieldType === 'integer'
        ? 'Entero'
        : d.fieldType === 'float'
          ? 'Decimal'
          : d.fieldType === 'date'
            ? 'Fecha (YYYY-MM-DD)'
            : 'Texto',
  }))
  const wsRef = XLSX.utils.json_to_sheet(refRows, { header: ['code', 'nombre', 'tipo'] })
  wsRef['!cols'] = [{ wch: 22 }, { wch: 32 }, { wch: 22 }]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Valores')
  XLSX.utils.book_append_sheet(wb, wsRef, 'Referencia')

  const buffer: Buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })

  return new Response(buffer as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="campos-adicionales-valores.xlsx"',
      'Content-Length': String(buffer.byteLength),
    },
  })
}
