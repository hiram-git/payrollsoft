/**
 * seed-loans.ts — Seeds 10 acreedores + their concepts + 1-4 loans per active employee.
 *
 * Usage: bun --env-file ../../.env src/seed-loans.ts
 *
 * Idempotent: deletes and recreates all loans associated with the seeded creditors.
 * Requires base seed (seed.ts) and employees (seed-stress.ts or manual inserts) to exist first.
 *
 * Creates:
 *   - 3 bancos  : BANISTMO, BAC, CAJAH
 *   - 7 financieras: FICOHSA, CREDIQ, COFISA, AZTEK, MULTIFIN, PRESTAMAS, CREDIFACIL
 *   - 1 concepto por acreedor (tipo deducción, CUOTA_ACREEDOR, print_details + use_amount_calc)
 *   - 1–4 préstamos aleatorios por empleado activo, cada uno con 12–36 cuotas mensuales
 */
import postgres from 'postgres'

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL is not set')
  process.exit(1)
}

const TENANT_SLUG = 'demo'
const BATCH_SIZE = 500

const sql = postgres(url, {
  prepare: false,
  connection: { search_path: `tenant_${TENANT_SLUG},public` },
  max: 10,
})

// ── Acreedores ────────────────────────────────────────────────────────────────

const BANKS = [
  { code: 'BANISTMO', name: 'Banistmo S.A.', description: 'Banco Banistmo, S.A.' },
  { code: 'BAC', name: 'BAC Internacional Bank', description: 'BAC Internacional Bank, Inc.' },
  { code: 'CAJAH', name: 'Caja de Ahorros', description: 'Caja de Ahorros de Panamá' },
]

const FINANCIERAS = [
  { code: 'FICOHSA', name: 'Financiera Ficohsa', description: 'Ficohsa Panamá S.A.' },
  { code: 'CREDIQ', name: 'CrediQ Panamá', description: 'CrediQ Panamá S.A.' },
  { code: 'COFISA', name: 'Cofisa Panamá', description: 'Cofisa Panamá S.A.' },
  { code: 'AZTEK', name: 'Financiera Azteka', description: 'Azteka Financiera S.A.' },
  { code: 'MULTIFIN', name: 'Multi Financiera', description: 'Multi Financiera S.A.' },
  { code: 'PRESTAMAS', name: 'PréstaMás', description: 'PréstaMás Panamá S.A.' },
  { code: 'CREDIFACIL', name: 'CrédiFácil', description: 'CrédiFácil Financiera S.A.' },
]

const ALL_ACREEDORES = [...BANKS, ...FINANCIERAS]

// ── Utilities ─────────────────────────────────────────────────────────────────

function rand(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function randFloat(min: number, max: number, decimals = 2): number {
  const v = min + Math.random() * (max - min)
  const factor = 10 ** decimals
  return Math.round(v * factor) / factor
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

function addMonths(date: Date, months: number): Date {
  const d = new Date(date)
  d.setMonth(d.getMonth() + months)
  return d
}

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** Shuffle array in place, return it. */
function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

// ── Main ──────────────────────────────────────────────────────────────────────

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

      // Installment plan
      const months = rand(12, 36)

      // Installment: 3–10% of monthly salary, capped to reasonable range
      const minInst = Math.max(25, salary * 0.03)
      const maxInst = Math.max(50, Math.min(500, salary * 0.1))
      const installmentAmt = randFloat(minInst, maxInst)
      const totalAmt = randFloat(installmentAmt * months, installmentAmt * months) // exact

      // Start date: between 3 and 36 months ago
      const startDate = addMonths(new Date(), -rand(3, 36))
      const endDate = addMonths(startDate, months)

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
          ${pick(loanTypes)}, 'monthly',
          true, true
        )
        RETURNING id
      `

      // Build installment rows (last one absorbs rounding difference)
      const remainder = Math.round((totalAmt - installmentAmt * (months - 1)) * 100) / 100

      for (let i = 1; i <= months; i++) {
        allInstallments.push({
          loan_id: loan.id,
          installment_number: i,
          amount: String(i === months ? remainder : installmentAmt),
          due_date: toDateStr(addMonths(startDate, i - 1)),
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
  console.log(
    `   Acreedores : ${ALL_ACREEDORES.length}  (${BANKS.length} bancos · ${FINANCIERAS.length} financieras)`
  )
  console.log(`   Préstamos  : ${totalLoans}`)
  console.log(`   Cuotas     : ${allInstallments.length}`)
  console.log(`   Empleados  : ${employees.length}`)
} catch (err) {
  console.error('\n✗  Seed falló:', err instanceof Error ? err.message : String(err))
  process.exit(1)
} finally {
  await sql.end()
}
