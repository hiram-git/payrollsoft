/**
 * Validación de formularios reutilizando `@payroll/core`.
 *
 * `findMissingRequired` es el mismo evaluador que usa la API al guardar
 * empleados y el importador masivo. Aquí se reusa para no reimplementar
 * la lógica de "campo requerido y vacío" en el cliente.
 */
import { findMissingRequired } from '@payroll/core'
import type { CustomFieldDefinitionLike } from '@payroll/core'

/**
 * Devuelve los códigos de campo requeridos que vienen vacíos.
 * `required` lista los nombres de campo obligatorios del formulario.
 */
export function missingRequiredFields(
  required: string[],
  values: Record<string, unknown>
): string[] {
  const defs: CustomFieldDefinitionLike[] = required.map((code) => ({
    code,
    fieldType: 'text',
    isRequired: true,
  }))
  return findMissingRequired(defs, values)
}
