/**
 * Helper compartido entre los tres consumidores del reporte de
 * acreedores (vista web, XLSX, PDF) — se encarga de:
 *
 *   1. Resolver qué definiciones de `custom_field_definitions` están
 *      marcadas con `validationRules.includeInCreditorsReport=true`.
 *   2. Cargar el catálogo de empleados activos con sus `customFields`
 *      (un solo round-trip) y devolverlo como `Map<employeeId, customFields>`.
 *   3. Formatear el valor de una celda según el `fieldType` declarado.
 *
 * Cada caller decide cómo renderizar las columnas; este módulo solo
 * normaliza la fuente de datos para que las tres vistas muestren
 * exactamente lo mismo.
 */

export type CreditorsCustomFieldDef = {
  code: string
  name: string
  fieldType: 'text' | 'integer' | 'float' | 'date'
}

type RawDef = {
  code: string
  name: string
  fieldType: 'text' | 'integer' | 'float' | 'date'
  isActive: boolean
  validationRules?: { includeInCreditorsReport?: boolean } | null
}

type RawEmployee = { id: string; customFields?: Record<string, unknown> | null }

export async function loadCreditorsExtras(
  apiUrl: string,
  headers: Record<string, string>
): Promise<{
  defs: CreditorsCustomFieldDef[]
  customFieldsByEmployee: Map<string, Record<string, unknown>>
}> {
  const empty = { defs: [], customFieldsByEmployee: new Map<string, Record<string, unknown>>() }

  let rawDefs: RawDef[] = []
  try {
    const res = await fetch(`${apiUrl}/custom-fields`, { headers })
    if (res.ok)
      rawDefs = (((await res.json()) as { data: RawDef[] }).data ?? []).filter((d) => d.isActive)
  } catch {
    return empty
  }
  const defs: CreditorsCustomFieldDef[] = rawDefs
    .filter((d) => d.validationRules?.includeInCreditorsReport === true)
    .map((d) => ({ code: d.code, name: d.name, fieldType: d.fieldType }))

  if (defs.length === 0) return empty

  const customFieldsByEmployee = new Map<string, Record<string, unknown>>()
  try {
    const res = await fetch(`${apiUrl}/employees?limit=2000&isActive=true`, { headers })
    if (res.ok) {
      const json = (await res.json()) as { data: RawEmployee[] }
      for (const emp of json.data ?? []) {
        customFieldsByEmployee.set(emp.id, (emp.customFields ?? {}) as Record<string, unknown>)
      }
    }
  } catch {
    /* sin empleados, devolvemos defs pero el map vacío — los callers
       mostrarán las columnas con valores vacíos */
  }

  return { defs, customFieldsByEmployee }
}

/**
 * Formatea un valor de campo adicional según su tipo. Devuelve un
 * primitivo apto tanto para celdas Excel (`number | string`) como para
 * texto en la UI.
 */
export function formatCustomFieldValue(
  def: CreditorsCustomFieldDef,
  raw: unknown
): string | number {
  if (raw == null || raw === '') return ''
  if (def.fieldType === 'integer') {
    const n = Number.parseInt(String(raw), 10)
    return Number.isFinite(n) ? n : ''
  }
  if (def.fieldType === 'float') {
    const n = Number(String(raw))
    return Number.isFinite(n) ? n : ''
  }
  if (def.fieldType === 'date') {
    const s = String(raw).slice(0, 10)
    return s
  }
  return String(raw)
}
