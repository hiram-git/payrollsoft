/**
 * Stress seed — inserts a configurable number of employees into the demo
 * tenant for load testing. Override with the `STRESS_TOTAL` env var:
 *   STRESS_TOTAL=5000 bun --env-file ../../.env src/seed-stress.ts
 *
 * Requires the base seed (seed.ts) to have run first so that
 * cargo, funcion, and departamento records exist.
 *
 * Safe to run multiple times: skips employees whose code already exists.
 */
import postgres from 'postgres'

const TENANT_SLUG = 'demo'
const BATCH_SIZE = 500
// Default tuned for end-to-end testing of the report pipeline (covers
// pagination + render perf without taking forever to seed). Bump via
// STRESS_TOTAL env var when you need to load-test larger volumes.
const TOTAL = Number(process.env.STRESS_TOTAL ?? '500')

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL is not set')
  process.exit(1)
}

const sql = postgres(url, {
  prepare: false,
  connection: { search_path: `tenant_${TENANT_SLUG},public` },
  max: 10,
})

// ── Name pools ────────────────────────────────────────────────────────────────
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

const FREQUENCIES = ['biweekly', 'biweekly', 'biweekly', 'monthly', 'weekly'] // weighted

// Panamanian cédula-style: province (1-9) - volume (1-999) - folio (1-9999)
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
  // Range $700 – $3500, increments of $50
  const base = 700 + (n % 57) * 50
  return base.toFixed(2)
}

function hireDate(n: number): string {
  // Spread over the last 10 years
  const daysAgo = n % 3650
  const d = new Date()
  d.setDate(d.getDate() - daysAgo)
  return d.toISOString().slice(0, 10)
}

// ── Load catalog IDs ──────────────────────────────────────────────────────────
const [cargos, funciones, departamentos] = await Promise.all([
  sql<{ id: string }[]>`SELECT id FROM cargos LIMIT 20`,
  sql<{ id: string }[]>`SELECT id FROM funciones LIMIT 20`,
  sql<{ id: string }[]>`SELECT id FROM departamentos LIMIT 20`,
])

if (cargos.length === 0 || funciones.length === 0 || departamentos.length === 0) {
  console.error('✗ No se encontraron cargos, funciones o departamentos. Ejecuta seed.ts primero.')
  await sql.end()
  process.exit(1)
}

console.log(
  `Usando ${cargos.length} cargo(s), ${funciones.length} función(es), ${departamentos.length} departamento(s)`
)

// ── Check existing count ──────────────────────────────────────────────────────
const [{ count: existing }] = await sql<{ count: string }[]>`
  SELECT COUNT(*) AS count FROM employees WHERE code LIKE 'EMP-%'
`
const already = Number(existing)
if (already >= TOTAL) {
  console.log(`✓ Ya existen ${already} empleados de estrés. Nada que hacer.`)
  await sql.end()
  process.exit(0)
}

const start = already
const remaining = TOTAL - already
console.log(`Generando ${remaining} empleados (${start} ya existen)…`)

// ── Batch insert ──────────────────────────────────────────────────────────────
let inserted = 0
const t0 = Date.now()

for (let batchStart = start; batchStart < TOTAL; batchStart += BATCH_SIZE) {
  const batchEnd = Math.min(batchStart + BATCH_SIZE, TOTAL)
  const rows = []

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

  inserted += rows.length
  const pct = Math.round((inserted / remaining) * 100)
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
  process.stdout.write(`\r  ${inserted}/${remaining} (${pct}%) — ${elapsed}s`)
}

const total_ms = Date.now() - t0
console.log(`\n\n✅  Listo! ${inserted} empleados insertados en ${(total_ms / 1000).toFixed(2)}s`)
console.log(`   ~${Math.round((inserted / total_ms) * 1000)} empleados/seg`)

await sql.end()
