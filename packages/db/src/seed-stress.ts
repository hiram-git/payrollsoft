/**
 * CLI shim del seed de empleados.
 *
 *   bun src/seed-stress.ts                       # tenant_demo, 500 empleados
 *   bun src/seed-stress.ts --tenant=acme         # otro tenant
 *   STRESS_TOTAL=5000 bun src/seed-stress.ts     # otro volumen
 *
 * La lógica vive en `seeds/employees.ts` y se reusa desde el flujo de
 * provisioning del super-admin. Este script solo arma la conexión y
 * llama la función exportada.
 */
import postgres from 'postgres'
import { seedEmployees } from './seeds/employees'

const args = process.argv.slice(2)
const tenantFlag = args.find((a) => a.startsWith('--tenant='))
const TENANT_SLUG = tenantFlag ? tenantFlag.split('=')[1] : (process.env.SEED_TENANT ?? 'demo')
const TOTAL = Number(process.env.STRESS_TOTAL ?? '500')

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL is not set')
  process.exit(1)
}

const sql = postgres(url, {
  prepare: false,
  connection: { search_path: `tenant_${TENANT_SLUG},payroll_auth,public` },
  max: 10,
})

console.log(`▸ Stress seed → tenant_${TENANT_SLUG} (objetivo: ${TOTAL} empleados)`)

try {
  const result = await seedEmployees(sql, { total: TOTAL, log: console.log })
  console.log(
    `\n✅  Listo. Insertados ${result.inserted} (preexistentes ${result.alreadyExisted}, total ${result.total}).`
  )
} catch (err) {
  console.error('\n✗  Seed falló:', err instanceof Error ? err.message : String(err))
  process.exit(1)
} finally {
  await sql.end()
}
