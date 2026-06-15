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

/**
 * Siembra un set demo mínimo de funciones, cargos y departamentos cuando el
 * tenant aún no los tiene. Idempotente (ON CONFLICT). Necesario para que el
 * seed de empleados funcione sobre un tenant provisionado desde el wizard,
 * cuyo bootstrap base no incluye estos catálogos.
 */
async function ensureBaseCatalogs(sql: postgres.Sql): Promise<void> {
  await sql`
    INSERT INTO job_functions (code, name) VALUES
      ('ADM', 'Administrativo'),
      ('OPE', 'Operativo'),
      ('VEN', 'Ventas')
    ON CONFLICT (code) DO NOTHING
  `
  await sql`
    INSERT INTO job_titles (code, name) VALUES
      ('EMP', 'Empleado General'),
      ('ANL', 'Analista'),
      ('SUP', 'Supervisor'),
      ('GER', 'Gerente')
    ON CONFLICT (code) DO NOTHING
  `
  const [admin] = await sql<{ id: string }[]>`
    INSERT INTO departments (code, name) VALUES ('ADMIN', 'Administración')
    ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
    RETURNING id
  `
  await sql`
    INSERT INTO departments (code, name, parent_id) VALUES
      ('RRHH', 'Recursos Humanos', ${admin.id})
    ON CONFLICT (code) DO NOTHING
  `
  await sql`
    INSERT INTO departments (code, name) VALUES
      ('OPS', 'Operaciones'),
      ('VEN', 'Ventas')
    ON CONFLICT (code) DO NOTHING
  `
}

export async function seedEmployees(
  sql: postgres.Sql,
  options: SeedEmployeesOptions = {}
): Promise<SeedEmployeesResult> {
  const total = Math.max(1, Math.min(10000, options.total ?? 200))
  const log = options.log ?? (() => {})

  // Catálogos requeridos (cargos/funciones/departamentos). Un tenant recién
  // provisionado desde el wizard NO los trae —las migraciones no los siembran
  // y el bootstrap base sólo crea roles/permisos/conceptos—, así que si faltan
  // los creamos aquí con un set demo mínimo en vez de abortar el seed.
  const fetchCatalogs = () =>
    Promise.all([
      sql<{ id: string }[]>`SELECT id FROM job_titles LIMIT 20`,
      sql<{ id: string }[]>`SELECT id FROM job_functions LIMIT 20`,
      sql<{ id: string }[]>`SELECT id FROM departments LIMIT 20`,
    ])
  let [cargos, funciones, departamentos] = await fetchCatalogs()
  if (cargos.length === 0 || funciones.length === 0 || departamentos.length === 0) {
    log('  catálogos base ausentes — sembrando cargos/funciones/departamentos demo')
    await ensureBaseCatalogs(sql)
    ;[cargos, funciones, departamentos] = await fetchCatalogs()
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
        job_title_id: pick(cargos, i).id,
        job_function_id: pick(funciones, i).id,
        department_id: pick(departamentos, i).id,
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
        'job_title_id',
        'job_function_id',
        'department_id',
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
