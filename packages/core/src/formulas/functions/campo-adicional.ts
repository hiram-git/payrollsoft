import type { FormulaContext } from '../types'

/**
 * CAMPOADICIONAL("codigo")
 *
 * Lee el valor de un campo adicional definido en el catálogo de
 * `custom_field_definitions` del tenant y guardado en
 * `employees.custom_fields` (jsonb). Devuelve el valor coercionado a
 * número: enteros y decimales se devuelven tal cual; strings que
 * representen un número se parsean; cualquier otra cosa (texto puro,
 * fechas, null, undefined) cae a 0 para que la fórmula no rompa.
 *
 * Si el campo no existe o el empleado no tiene valor, devuelve 0 —
 * mismo comportamiento que CONCEPTO() para mantener el contrato.
 */
export async function CAMPOADICIONAL(
  args: (number | string)[],
  ctx: FormulaContext
): Promise<number> {
  if (args.length < 1) {
    throw new Error('CAMPOADICIONAL() requires a field code argument')
  }
  const code = String(args[0])
  const value = ctx.employee.customFields?.[code]
  if (value == null) return 0
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  if (typeof value === 'boolean') return value ? 1 : 0
  if (typeof value === 'string') {
    const n = Number(value)
    return Number.isFinite(n) ? n : 0
  }
  return 0
}
