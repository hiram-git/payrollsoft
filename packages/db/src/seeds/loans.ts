/**
 * Seed `loans` — versión exportable y reutilizable.
 *
 * Crea 10 acreedores (3 bancos + 7 financieras), un concepto de
 * deducción por cada uno (`ACR_<CODE>`) y 1–4 préstamos quincenales
 * por cada empleado activo, con sus cuotas pendientes.
 *
 * IMPORTANTE: para mantener la idempotencia, antes de crear nuevos
 * préstamos se eliminan todos los préstamos previos asociados a estos
 * acreedores semilla. Eso sigue siendo seguro porque el flag de
 * "seed aplicado" guardado en `payroll_auth.tenants.metadata.seeds`
 * impide que la wizard ejecute el seed dos veces sobre la misma
 * empresa (ver provisioning.ts). El reset solo dispara si alguien
 * lo invoca explícitamente desde el CLI.
 */
import type postgres from 'postgres'

export type SeedLoansOptions = {
  log?: (line: string) => void
}

export type SeedLoansResult = {
  creditorsCreated: number
  loansCreated: number
  installmentsCreated: number
  employeesAffected: number
  loansDeleted: number
  installmentsDeleted: number
}

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
const BATCH_SIZE = 500
const DAYS_PER_QUINCENA = 15

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
function addDays(date: Date, days: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}
function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10)
}
function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

export async function seedLoans(
  sql: postgres.Sql,
  options: SeedLoansOptions = {}
): Promise<SeedLoansResult> {
  const log = options.log ?? (() => {})

  log('▸ Creando conceptos y acreedores')
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
  }

  // Limpieza idempotente — solo para que un caller que pase el flag de
  // "force" pueda re-correr; en el flujo normal el guard del wizard ya
  // bloquea segundas ejecuciones.
  const creditorIds = Object.values(creditorMap).map((c) => c.id)
  const deletedInst = await sql`
    WITH removed AS (
      DELETE FROM loan_installments
      WHERE loan_id IN (SELECT id FROM loans WHERE creditor_id = ANY(${creditorIds}))
      RETURNING 1
    )
    SELECT COUNT(*) AS n FROM removed
  `
  const deletedInstCount = Number(deletedInst[0]?.n ?? 0)
  const removedLoans = await sql`
    DELETE FROM loans WHERE creditor_id = ANY(${creditorIds}) RETURNING 1
  `
  const deletedLoansCount = removedLoans.length

  const employees = await sql<{ id: string; base_salary: string }[]>`
    SELECT id, base_salary FROM employees WHERE is_active = true ORDER BY code
  `
  if (employees.length === 0) {
    throw new Error(
      'No hay empleados activos en el tenant. Siembra empleados primero (seed de Empleados).'
    )
  }

  log(`▸ Generando préstamos para ${employees.length} empleados`)
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

  for (const emp of employees) {
    const loanCount = rand(1, 4)
    const salary = Number(emp.base_salary)
    const selected = shuffle([...creditorCodes]).slice(0, loanCount)

    for (const code of selected) {
      const { id: creditorId, name: creditorName } = creditorMap[code]
      const months = rand(12, 36)
      const installmentCount = months * 2
      const minInst = Math.max(15, salary * 0.015)
      const maxInst = Math.max(30, Math.min(300, salary * 0.05))
      const installmentAmt = randFloat(minInst, maxInst)
      const totalAmt = installmentAmt * installmentCount
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
  }

  log(`▸ Insertando ${allInstallments.length} cuotas`)
  for (let i = 0; i < allInstallments.length; i += BATCH_SIZE) {
    const batch = allInstallments.slice(i, i + BATCH_SIZE)
    await sql`INSERT INTO loan_installments ${sql(batch)}`
  }

  return {
    creditorsCreated: ALL_ACREEDORES.length,
    loansCreated: totalLoans,
    installmentsCreated: allInstallments.length,
    employeesAffected: employees.length,
    loansDeleted: deletedLoansCount,
    installmentsDeleted: deletedInstCount,
  }
}
