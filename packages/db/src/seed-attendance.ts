/**
 * CLI del seed de asistencia del mes pasado.
 *
 *   bun src/seed-attendance.ts                        # tenant demo, mes pasado
 *   bun src/seed-attendance.ts --tenant=otra-empresa  # otro tenant
 *   ABSENCE_RATE=0.02 LATENESS_RATE=0.05 bun src/seed-attendance.ts
 *   MONTH_OFFSET=-2 bun src/seed-attendance.ts         # antepasado
 *
 * La lógica vive en `seeds/attendance.ts`. Este script solo arma la
 * conexión apuntando al schema del tenant y llama la función exportada.
 */
import postgres from 'postgres'
import { seedAttendance } from './seeds/attendance'

const args = process.argv.slice(2)
const tenantFlag = args.find((a) => a.startsWith('--tenant='))
const TENANT_SLUG = tenantFlag ? tenantFlag.split('=')[1] : (process.env.SEED_TENANT ?? 'demo')

const absenceRate = process.env.ABSENCE_RATE ? Number(process.env.ABSENCE_RATE) : 0.02
const latenessRate = process.env.LATENESS_RATE ? Number(process.env.LATENESS_RATE) : 0.05
const monthOffset = process.env.MONTH_OFFSET ? Number(process.env.MONTH_OFFSET) : -1

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

console.log(
  `▸ Seed de asistencia → tenant_${TENANT_SLUG} ` +
    `(ausencias ${(absenceRate * 100).toFixed(1)}%, tardanzas ${(latenessRate * 100).toFixed(1)}%)`
)

try {
  const result = await seedAttendance(sql, {
    absenceRate,
    latenessRate,
    monthOffset,
    log: console.log,
  })
  console.log(
    `\n✅  Listo. ${result.employees} empleados · ${result.punches} punches · ` +
      `presentes ${result.present}, tarde ${result.late}, ausentes ${result.absent}.`
  )
} catch (err) {
  console.error('\n✗  Seed falló:', err instanceof Error ? err.message : String(err))
  process.exit(1)
} finally {
  await sql.end()
}
