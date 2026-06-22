/**
 * Convierte el valor (jsonb) de un campo adicional a string para
 * precargarlo en un <input>. Respeta el tipo de campo para fechas.
 */
export function customFieldValueToString(v: unknown, fieldType?: string): string {
  if (v == null) return ''
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (fieldType === 'date' && typeof v === 'string') return v.slice(0, 10)
  return String(v)
}
