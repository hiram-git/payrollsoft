/**
 * Evaluador de dependencias entre campos adicionales.
 *
 * El catálogo (`custom_field_definitions.validation_rules`) puede llevar
 * una lista `dependsOn` con reglas del tipo
 *
 *   { field: 'estado_civil', op: 'eq', value: 'casado', effect: 'required' }
 *
 * que se interpretan así: el efecto (`required`/`visible`/`readonly`) se
 * activa si la condición sobre el campo padre se cumple. Cuando hay
 * varias reglas con el mismo efecto, se combinan con AND. Si no hay
 * reglas para un efecto, ese efecto se queda en su valor estático
 * (`required` cae a `definition.isRequired`, `visible` y `readonly` por
 * defecto a true/false respectivamente).
 *
 * Este módulo se comparte entre la API (validación al guardar empleado),
 * el SSR del formulario (render inicial), el script cliente (toggle en
 * vivo) y el importador masivo. Mantenerlo puro/sin I/O permite usarlo
 * desde el navegador sin más.
 */

export type DependencyOp = 'eq' | 'ne' | 'gt' | 'lt' | 'gte' | 'lte' | 'in' | 'empty' | 'notEmpty'

export type DependencyEffect = 'required' | 'visible' | 'readonly'

export type DependencyRule = {
  field: string
  op: DependencyOp
  value?: unknown
  values?: unknown[]
  effect: DependencyEffect
}

export type CustomFieldDefinitionLike = {
  code: string
  fieldType: 'text' | 'integer' | 'float' | 'date'
  isRequired: boolean
  isActive?: boolean
  validationRules?: { dependsOn?: DependencyRule[] } | null | unknown
}

export type EffectiveState = {
  visible: boolean
  required: boolean
  readonly: boolean
}

/**
 * Lee `validationRules.dependsOn` con tolerancia a tipos: descarta
 * reglas mal formadas para no reventar el render por una entrada
 * corrupta en el jsonb.
 */
export function readDependencyRules(def: CustomFieldDefinitionLike): DependencyRule[] {
  const rules =
    def.validationRules &&
    typeof def.validationRules === 'object' &&
    'dependsOn' in (def.validationRules as Record<string, unknown>)
      ? (def.validationRules as { dependsOn?: unknown }).dependsOn
      : null
  if (!Array.isArray(rules)) return []
  const out: DependencyRule[] = []
  for (const r of rules as Array<Record<string, unknown>>) {
    if (!r || typeof r !== 'object') continue
    const field = typeof r.field === 'string' ? r.field : null
    const op = typeof r.op === 'string' ? (r.op as DependencyOp) : null
    const effect = typeof r.effect === 'string' ? (r.effect as DependencyEffect) : null
    if (!field || !op || !effect) continue
    if (!['required', 'visible', 'readonly'].includes(effect)) continue
    if (!['eq', 'ne', 'gt', 'lt', 'gte', 'lte', 'in', 'empty', 'notEmpty'].includes(op as string)) {
      continue
    }
    out.push({
      field,
      op,
      value: r.value,
      values: Array.isArray(r.values) ? r.values : undefined,
      effect,
    })
  }
  return out
}

function isEmptyValue(v: unknown): boolean {
  if (v == null) return true
  if (typeof v === 'string') return v.trim().length === 0
  if (Array.isArray(v)) return v.length === 0
  return false
}

function toComparable(v: unknown): number | string | null {
  if (v == null || v === '') return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'boolean') return v ? 1 : 0
  if (typeof v === 'string') {
    const n = Number(v)
    if (Number.isFinite(n) && v.trim() !== '') return n
    return v
  }
  return String(v)
}

function compare(a: unknown, b: unknown): number | null {
  const ca = toComparable(a)
  const cb = toComparable(b)
  if (ca == null || cb == null) return null
  if (typeof ca === 'number' && typeof cb === 'number') return ca - cb
  return String(ca).localeCompare(String(cb))
}

export function evaluateRule(rule: DependencyRule, allValues: Record<string, unknown>): boolean {
  const v = allValues[rule.field]
  switch (rule.op) {
    case 'eq':
      return String(v ?? '') === String(rule.value ?? '')
    case 'ne':
      return String(v ?? '') !== String(rule.value ?? '')
    case 'gt': {
      const c = compare(v, rule.value)
      return c != null && c > 0
    }
    case 'lt': {
      const c = compare(v, rule.value)
      return c != null && c < 0
    }
    case 'gte': {
      const c = compare(v, rule.value)
      return c != null && c >= 0
    }
    case 'lte': {
      const c = compare(v, rule.value)
      return c != null && c <= 0
    }
    case 'in':
      return (rule.values ?? []).some((x) => String(x) === String(v ?? ''))
    case 'empty':
      return isEmptyValue(v)
    case 'notEmpty':
      return !isEmptyValue(v)
  }
}

/**
 * Calcula el estado efectivo de cada definición según sus reglas y los
 * valores actuales del formulario. AND entre reglas del mismo efecto.
 */
export function evaluateDependencies(
  defs: CustomFieldDefinitionLike[],
  values: Record<string, unknown>
): Record<string, EffectiveState> {
  const result: Record<string, EffectiveState> = {}
  for (const def of defs) {
    const rules = readDependencyRules(def)
    const byEffect: Record<DependencyEffect, DependencyRule[]> = {
      required: [],
      visible: [],
      readonly: [],
    }
    for (const r of rules) byEffect[r.effect].push(r)

    const visible =
      byEffect.visible.length === 0 ? true : byEffect.visible.every((r) => evaluateRule(r, values))
    const required =
      byEffect.required.length === 0
        ? !!def.isRequired
        : !!def.isRequired || byEffect.required.every((r) => evaluateRule(r, values))
    const readonly =
      byEffect.readonly.length === 0
        ? false
        : byEffect.readonly.every((r) => evaluateRule(r, values))

    result[def.code] = { visible, required, readonly }
  }
  return result
}

/**
 * Aplica el evaluador y devuelve la lista de códigos cuyos campos están
 * marcados como `required` (y `visible`) pero no traen valor en el
 * payload. Útil tanto en la API para rechazar el PUT como en el
 * importador masivo para fallar la fila.
 */
export function findMissingRequired(
  defs: CustomFieldDefinitionLike[],
  values: Record<string, unknown>
): string[] {
  const states = evaluateDependencies(defs, values)
  const missing: string[] = []
  for (const def of defs) {
    const st = states[def.code]
    if (!st) continue
    if (!st.visible || !st.required) continue
    if (isEmptyValue(values[def.code])) missing.push(def.code)
  }
  return missing
}
