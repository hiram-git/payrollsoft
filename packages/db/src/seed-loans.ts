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
  // ── 1. Create concepts + creditors ──────────────────────────────────────────
  console.log('\n📋  Creando conceptos y acreedores...\n')

  const creditorMap: Record<string, { id: string; name: string }> = {}

  for (const acr of ALL_ACREEDORES) {
    const conceptCode = `ACR_${acr.code}`
    const conceptName = `Préstamo ${acr.name}`
    const formula = `CUOTA_ACREEDOR("${acr.code}")`

    const [concept] = await sql<{ id: string }[]>`
      INSERT INTO concepts
        (code, name, type, formula, is_active, print_details, use_amount_calc)
      VALUES
        (${conceptCode}, ${conceptName}, 'deduction', ${formula}, true, true, true)
      ON CONFLICT (code) DO UPDATE SET
        name            = EXCLUDED.name,
        formula         = EXCLUDED.formula,
        print_details   = EXCLUDED.print_details,
        use_amount_calc = EXCLUDED.use_amount_calc
      RETURNING id
    `

    const [creditor] = await sql<{ id: string }[]>`
      INSERT INTO creditors (code, name, description, concept_id, is_active)
      VALUES (${acr.code}, ${acr.name}, ${acr.description}, ${concept.id}, true)
      ON CONFLICT (code) DO UPDATE SET
        name        = EXCLUDED.name,
        description = EXCLUDED.description,
        concept_id  = EXCLUDED.concept_id
      RETURNING id
    `

    creditorMap[acr.code] = { id: creditor.id, name: acr.name }

    const tag = BANKS.some((b) => b.code === acr.code) ? 'Banco     ' : 'Financiera'
    console.log(`  ✓ ${tag}  ${acr.code.padEnd(12)}  ${acr.name}  [${conceptCode}]`)
  }

  // ── 2. Reset loans seeded by this script ────────────────────────────────────
  console.log('\n🗑️   Limpiando préstamos previos de estos acreedores...')

  const creditorIds = Object.values(creditorMap).map((c) => c.id)

  const deleted = await sql`
    WITH removed AS (
      DELETE FROM loan_installments
      WHERE loan_id IN (
        SELECT id FROM loans WHERE creditor_id = ANY(${creditorIds})
      )
      RETURNING 1
    )
    SELECT COUNT(*) AS n FROM removed
  `
  const deletedInst = Number(deleted[0]?.n ?? 0)

  const removedLoans = await sql`
    DELETE FROM loans WHERE creditor_id = ANY(${creditorIds}) RETURNING 1
  `
  const deletedLoansN = removedLoans.length

  console.log(`  ✓ Eliminados ${deletedLoansN} préstamos y ${deletedInst} cuotas`)

  // ── 3. Load employees ────────────────────────────────────────────────────────
  const employees = await sql<{ id: string; base_salary: string }[]>`
    SELECT id, base_salary FROM employees WHERE is_active = true ORDER BY code
  `

  if (employees.length === 0) {
    console.log('\n⚠️  No hay empleados activos. Ejecuta seed-stress.ts primero.')
    await sql.end()
    process.exit(0)
  }

  console.log(`\n👥  Generando préstamos para ${employees.length} empleados...`)

  const creditorCodes = Object.keys(creditorMap)
  const loanTypes = ['personal', 'auto', 'educacion', 'hipotecario']

  let totalLoans = 0
  const allInstallments: {
    loan_id: string
    installment_number: number
    amount: string
    due_date: string
    status: string
  }[] = []

  // ── 4. Generate loans ────────────────────────────────────────────────────────
  for (const emp of employees) {
    const loanCount = rand(1, 4)
    const salary = Number(emp.base_salary)

    // Pick loanCount distinct creditors at random
    const selected = shuffle([...creditorCodes]).slice(0, loanCount)

    for (const code of selected) {
      const { id: creditorId, name: creditorName } = creditorMap[code]

      // Loan term: 12–36 months, expressed as biweekly cuotas (×2). Halving
      // the per-cuota amount keeps total loan principal in the same range
      // as the previous monthly model while matching how panameñan
      // payrolls actually pay creditors (every quincena).
      const months = rand(12, 36)
      const installmentCount = months * 2

      // Per-cuota amount: 1.5–5% of monthly salary (i.e. half of what a
      // monthly schedule would charge), capped to a reasonable range.
      const minInst = Math.max(15, salary * 0.015)
      const maxInst = Math.max(30, Math.min(300, salary * 0.05))
      const installmentAmt = randFloat(minInst, maxInst)
      // installmentAmt is already rounded to 2 decimals, but multiplying
      // a binary float by an integer reintroduces precision artifacts
      // (e.g. 53.99 × 48 = 2591.5200000000004). Round once more after
      // the product so loans.amount / balance carry exactly 2 decimals.
      const totalAmt = Math.round(installmentAmt * installmentCount * 100) / 100

      // Start date: between 3 and 36 months ago, anchored to a quincena
      // boundary so due_dates land on the typical 15th / 30th cadence.
      const startDate = addMonths(new Date(), -rand(3, 36))
      const endDate = addDays(startDate, installmentCount * DAYS_PER_QUINCENA)

      const [loan] = await sql<{ id: string }[]>`
        INSERT INTO loans (
          employee_id, creditor_id, creditor,
          amount, balance, installment,
          start_date, end_date,
          loan_type, frequency,
          is_active, allow_december
        ) VALUES (
          ${emp.id}, ${creditorId}, ${creditorName},
          ${String(totalAmt)}, ${String(totalAmt)}, ${String(installmentAmt)},
          ${toDateStr(startDate)}, ${toDateStr(endDate)},
          ${pick(loanTypes)}, 'quincenal',
          true, true
        )
        RETURNING id
      `

      // Build installment rows (last one absorbs rounding difference).
      const remainder = Math.round((totalAmt - installmentAmt * (installmentCount - 1)) * 100) / 100

      for (let i = 1; i <= installmentCount; i++) {
        allInstallments.push({
          loan_id: loan.id,
          installment_number: i,
          amount: String(i === installmentCount ? remainder : installmentAmt),
          due_date: toDateStr(addDays(startDate, (i - 1) * DAYS_PER_QUINCENA)),
          status: 'pending',
        })
      }

      totalLoans++
    }

    // Progress every 250 employees
    if (employees.indexOf(emp) % 250 === 249) {
      console.log(`  … ${employees.indexOf(emp) + 1} / ${employees.length} empleados`)
    }
  }

  // ── 5. Batch-insert installments ─────────────────────────────────────────────
  console.log(`\n📥  Insertando ${allInstallments.length} cuotas en lotes de ${BATCH_SIZE}...`)

  for (let i = 0; i < allInstallments.length; i += BATCH_SIZE) {
    const batch = allInstallments.slice(i, i + BATCH_SIZE)
    await sql`INSERT INTO loan_installments ${sql(batch)}`
    if ((i / BATCH_SIZE) % 10 === 9) {
      console.log(`  … ${i + batch.length} / ${allInstallments.length}`)
    }
  }

  // ── Summary ───────────────────────────────────────────────────────────────────
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
