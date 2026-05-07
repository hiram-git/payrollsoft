/**
 * CLI shim del seed de préstamos.
 *
 *   bun src/seed-loans.ts                     # → tenant_demo
 *   bun src/seed-loans.ts --tenant=acme       # → otro tenant
 *
 * La lógica vive en `seeds/loans.ts` y se reusa desde el flujo de
 * provisioning del super-admin. Este script solo arma la conexión y
 * llama la función exportada.
 */
import postgres from 'postgres'
import { seedLoans } from './seeds/loans'

const args = process.argv.slice(2)
const tenantFlag = args.find((a) => a.startsWith('--tenant='))
const TENANT_SLUG = tenantFlag ? tenantFlag.split('=')[1] : (process.env.SEED_TENANT ?? 'demo')

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

console.log(`▸ Loans seed → tenant_${TENANT_SLUG}`)

try {
  const result = await seedLoans(sql, { log: console.log })
  console.log('\n✅  Seed de préstamos completo!\n')
  console.log(`   Acreedores : ${result.creditorsCreated}`)
  console.log(`   Préstamos  : ${result.loansCreated}`)
  console.log(`   Cuotas     : ${result.installmentsCreated}`)
  console.log(`   Empleados  : ${result.employeesAffected}`)
} catch (err) {
  console.error('\n✗  Seed falló:', err instanceof Error ? err.message : String(err))
  process.exit(1)
} finally {
  await sql.end()
}
