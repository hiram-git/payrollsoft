/**
 * Seed `employees` — versión exportable y reutilizable.
 *
 * Diseñada para correr desde dos lugares con el mismo código:
 *  - El CLI `seed-stress.ts` (mantiene el contrato histórico).
 *  - El flujo de provisioning vía `provisionTenant` cuando un super-admin
 *    elige sembrar empleados al crear una empresa nueva.
 *
 * No abre conexiones — el caller pasa un `postgres.Sql` ya apuntando al
 * schema del tenant. Tampoco llama `process.exit`; los errores se propagan
 * vía throw para que el caller decida qué hacer (HTTP 500, log + retry,
 * etc).
 *
 * Idempotente: usa `ON CONFLICT (code) DO NOTHING` y se detiene si ya hay
 * `total` empleados con prefijo `EMP-`.
 */
import type postgres from 'postgres'

export type SeedEmployeesOptions = {
  /** Cantidad objetivo de empleados con prefijo EMP-. Default 200. */
  total?: number
  /** Callback para reportar progreso. Default: silencioso. */
  log?: (line: string) => void
}

export type SeedEmployeesResult = {
  total: number
  inserted: number
  alreadyExisted: number
  cargosUsed: number
  funcionesUsed: number
  departamentosUsed: number
}

const FIRST_NAMES = [
  'Ana',
  'Carlos',
  'María',
  'José',
  'Luis',
  'Laura',
  'Pedro',
  'Isabel',
  'Jorge',
  'Carmen',
  'Miguel',
  'Rosa',
  'Juan',
  'Patricia',
  'Roberto',
  'Gloria',
  'Alberto',
  'Sandra',
  'Fernando',
  'Diana',
  'Ricardo',
  'Claudia',
  'Héctor',
  'Mónica',
  'Ramón',
  'Adriana',
  'Eduardo',
  'Valeria',
  'Sergio',
  'Paola',
  'Andrés',
  'Natalia',
  'Francisco',
  'Andrea',
  'Manuel',
  'Daniela',
  'Guillermo',
  'Alejandra',
  'Arturo',
  'Mariana',
  'Víctor',
  'Gabriela',
  'Ernesto',
  'Lucía',
  'Rafael',
  'Verónica',
  'Ignacio',
  'Fernanda',
  'Enrique',
  'Catalina',
  'Oswaldo',
  'Beatriz',
  'Rodrigo',
  'Lorena',
  'Gustavo',
  'Silvia',
]

const LAST_NAMES = [
  'González',
  'Rodríguez',
  'Martínez',
  'García',
  'López',
  'Hernández',
  'Pérez',
  'Sánchez',
  'Ramírez',
  'Torres',
  'Flores',
  'Rivera',
  'Gómez',
  'Díaz',
  'Cruz',
  'Morales',
  'Reyes',
  'Jiménez',
  'Vargas',
  'Castillo',
  'Ortega',
  'Ruiz',
  'Mendoza',
  'Guerrero',
  'Delgado',
  'Aguilar',
  'Vega',
  'Herrera',
  'Medina',
  'Rojas',
  'Núñez',
  'Campos',
  'Moreno',
  'Navarro',
  'Ramos',
  'Alvarado',
  'Espinoza',
  'Arias',
  'Miranda',
  'Montes',
  'Fuentes',
  'Paredes',
  'Ibáñez',
  'Pinto',
  'Salazar',
  'Cárdenas',
  'Peña',
  'Suárez',
  'Contreras',
  'Lara',
  'Gutiérrez',
  'Valdés',
  'Cordero',
  'Bravo',
  'Cifuentes',
]

const FREQUENCIES = ['biweekly', 'biweekly', 'biweekly', 'monthly', 'weekly']

const BATCH_SIZE = 500

function cedula(n: number): string {
  const province = (n % 9) + 1
  const volume = Math.floor(n / 9) % 1000
  const folio = n % 10000
  return `${province}-${String(volume).padStart(3, '0')}-${String(folio).padStart(4, '0')}`
}

function pick<T>(arr: T[], seed: number): T {
  return arr[seed % arr.length]
}

function salary(n: number): string {
  const base = 700 + (n % 57) * 50
  return base.toFixed(2)
}

function hireDate(n: number): string {
  const daysAgo = n % 3650
  const d = new Date()
  d.setDate(d.getDate() - daysAgo)
  return d.toISOString().slice(0, 10)
}

export async function seedEmployees(
  sql: postgres.Sql,
  options: SeedEmployeesOptions = {}
): Promise<SeedEmployeesResult> {
  const total = Math.max(1, Math.min(10000, options.total ?? 200))
  const log = options.log ?? (() => {})

  // Catálogos: requeridos por el seed base (cargos/funciones/departamentos).
  const [cargos, funciones, departamentos] = await Promise.all([
    sql<{ id: string }[]>`SELECT id FROM cargos LIMIT 20`,
    sql<{ id: string }[]>`SELECT id FROM funciones LIMIT 20`,
    sql<{ id: string }[]>`SELECT id FROM departamentos LIMIT 20`,
  ])
  if (cargos.length === 0 || funciones.length === 0 || departamentos.length === 0) {
    throw new Error(
      'Faltan catálogos base (cargos/funciones/departamentos). Corre el seed base antes de sembrar empleados.'
    )
  }

  // Tipo de planilla por defecto — los empleados se ligan a este para que
  // aparezcan bajo el filtro mandatorio del topbar.
  const [defaultType] = await sql<{ id: string }[]>`
    SELECT id FROM concept_payroll_types ORDER BY sort_order ASC LIMIT 1
  `
  if (!defaultType) {
    throw new Error(
      'No hay tipos de planilla. Re-aprovisiona el tenant para que se siembren los conceptos por defecto.'
    )
  }

  const [{ count: existing }] = await sql<{ count: string }[]>`
    SELECT COUNT(*) AS count FROM employees WHERE code LIKE 'EMP-%'
  `
  const already = Number(existing)
  if (already >= total) {
    log(`✓ Ya existen ${already} empleados de stress; nada que sembrar.`)
    return {
      total: already,
      inserted: 0,
      alreadyExisted: already,
      cargosUsed: cargos.length,
      funcionesUsed: funciones.length,
      departamentosUsed: departamentos.length,
    }
  }

  log(`▸ Generando ${total - already} empleados (${already} preexistentes).`)
  let inserted = 0
  for (let batchStart = already; batchStart < total; batchStart += BATCH_SIZE) {
    const batchEnd = Math.min(batchStart + BATCH_SIZE, total)
    const rows: Array<Record<string, unknown>> = []
    for (let i = batchStart; i < batchEnd; i++) {
      const firstName = pick(FIRST_NAMES, i * 7 + 3)
      const lastName1 = pick(LAST_NAMES, i * 13 + 5)
      const lastName2 = pick(LAST_NAMES, i * 17 + 11)
      rows.push({
        code: `EMP-${String(i + 1).padStart(5, '0')}`,
        first_name: firstName,
        last_name: `${lastName1} ${lastName2}`,
        id_number: cedula(i + 10000),
        social_security_number: `${(i % 9) + 1}-${String(i + 1000).padStart(6, '0')}`,
        email: `emp${i + 1}@demo.internal`,
        cargo_id: pick(cargos, i).id,
        funcion_id: pick(funciones, i).id,
        departamento_id: pick(departamentos, i).id,
        hire_date: hireDate(i),
        base_salary: salary(i),
        pay_frequency: pick(FREQUENCIES, i),
        is_active: true,
      })
    }

    await sql`
      INSERT INTO employees ${sql(
        rows,
        'code',
        'first_name',
        'last_name',
        'id_number',
        'social_security_number',
        'email',
        'cargo_id',
        'funcion_id',
        'departamento_id',
        'hire_date',
        'base_salary',
        'pay_frequency',
        'is_active'
      )}
      ON CONFLICT (code) DO NOTHING
    `

    await sql`
      INSERT INTO employee_payroll_types (employee_id, payroll_type_id)
      SELECT e.id, ${defaultType.id}::uuid
      FROM employees e
      WHERE e.code = ANY(${rows.map((r) => r.code as string)})
      ON CONFLICT DO NOTHING
    `

    inserted += rows.length
    log(`  · ${inserted}/${total - already}`)
  }

  return {
    total,
    inserted,
    alreadyExisted: already,
    cargosUsed: cargos.length,
    funcionesUsed: funciones.length,
    departamentosUsed: departamentos.length,
  }
}
