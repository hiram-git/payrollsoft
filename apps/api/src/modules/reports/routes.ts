import { sql } from 'drizzle-orm'
/**
 * Reportes consolidados a nivel de empresa.
 *
 * Por ahora solo expone `/reports/creditors`, pensado para que el área
 * de cuentas por pagar arme los cheques o transferencias mensuales a
 * cada acreedor (banco, financiera, embargo, cuota sindical, etc).
 *
 * Fuente: `payroll_acumulados`, que es la proyección denormalizada de
 * `payroll_lines.concepts` y vive una fila por (planilla × empleado ×
 * concepto). Esto es preferible a leer JSONB de payroll_lines porque
 * permite GROUP BY directo, y es más confiable que sumar
 * `loan_installments` cuando el descuento puede ser distinto al
 * `installment` original (overrides manuales, ajustes).
 *
 * El JOIN con `creditors` se hace por `concepts.id = creditors.concept_id`,
 * la convención que ya usa el resto del sistema (cada acreedor tiene
 * un concepto deducción `ACR_<CODE>` asociado).
 */
import { Elysia, t } from 'elysia'
import { authPlugin, guardAuth, guardPermission } from '../../middleware/auth'
import { guardTenantMatchesToken, tenantPlugin } from '../../middleware/tenant'

// biome-ignore lint/suspicious/noExplicitAny: Drizzle generic
type AnyDb = any

type CreditorReportRow = {
  creditorId: string
  creditorCode: string
  creditorName: string
  conceptCode: string
  amount: string
  payrollId: string
  payrollName: string
  periodStart: string
  periodEnd: string
  employeeId: string
  employeeCode: string
  firstName: string
  lastName: string
}

function monthRange(year: number, month: number) {
  // month is 1..12. Returns [start, nextStart) as ISO date strings.
  const pad = (n: number) => String(n).padStart(2, '0')
  const start = `${year}-${pad(month)}-01`
  const ny = month === 12 ? year + 1 : year
  const nm = month === 12 ? 1 : month + 1
  const next = `${ny}-${pad(nm)}-01`
  return { start, next }
}

async function fetchCreditorReport(
  db: AnyDb,
  year: number,
  month: number,
  payrollTypeId?: string
): Promise<CreditorReportRow[]> {
  const { start, next } = monthRange(year, month)
  // Filtramos por p.period_end ∈ mes (la planilla "que terminó" en el
  // mes), y solo planillas cerradas. Si más adelante se necesita por
  // paymentDate puede agregarse una columna del query.
  const rows = await db.execute(sql`
    SELECT
      c.id          AS creditor_id,
      c.code        AS creditor_code,
      c.name        AS creditor_name,
      pa.concept_code,
      pa.amount,
      p.id          AS payroll_id,
      p.name        AS payroll_name,
      p.period_start,
      p.period_end,
      e.id          AS employee_id,
      e.code        AS employee_code,
      e.first_name,
      e.last_name
    FROM payroll_acumulados pa
    JOIN payrolls   p  ON p.id = pa.payroll_id
    JOIN concepts   cn ON cn.code = pa.concept_code
    JOIN creditors  c  ON c.concept_id = cn.id
    JOIN employees  e  ON e.id = pa.employee_id
    WHERE p.period_end >= ${start}::date
      AND p.period_end <  ${next}::date
      AND p.status = 'closed'
      ${payrollTypeId ? sql`AND p.payroll_type_id = ${payrollTypeId}::uuid` : sql``}
      AND c.is_active = true
      AND pa.amount::numeric > 0
    ORDER BY c.name ASC, e.last_name ASC, e.first_name ASC, p.period_end ASC
  `)
  return (rows as unknown as Array<Record<string, unknown>>).map((r) => ({
    creditorId: String(r.creditor_id),
    creditorCode: String(r.creditor_code),
    creditorName: String(r.creditor_name),
    conceptCode: String(r.concept_code),
    amount: String(r.amount ?? '0'),
    payrollId: String(r.payroll_id),
    payrollName: String(r.payroll_name ?? ''),
    periodStart: String(r.period_start ?? ''),
    periodEnd: String(r.period_end ?? ''),
    employeeId: String(r.employee_id),
    employeeCode: String(r.employee_code ?? ''),
    firstName: String(r.first_name ?? ''),
    lastName: String(r.last_name ?? ''),
  }))
}

type CreditorSummary = {
  creditorId: string
  creditorCode: string
  creditorName: string
  total: string
  employeeCount: number
  installmentCount: number
  details: CreditorReportRow[]
}

function summarize(rows: CreditorReportRow[]): CreditorSummary[] {
  const byCreditor = new Map<string, CreditorSummary>()
  for (const row of rows) {
    let bucket = byCreditor.get(row.creditorId)
    if (!bucket) {
      bucket = {
        creditorId: row.creditorId,
        creditorCode: row.creditorCode,
        creditorName: row.creditorName,
        total: '0',
        employeeCount: 0,
        installmentCount: 0,
        details: [],
      }
      byCreditor.set(row.creditorId, bucket)
    }
    bucket.details.push(row)
    bucket.total = (Number(bucket.total) + Number(row.amount)).toFixed(2)
    bucket.installmentCount++
  }
  for (const bucket of byCreditor.values()) {
    const employees = new Set(bucket.details.map((d) => d.employeeId))
    bucket.employeeCount = employees.size
  }
  return Array.from(byCreditor.values()).sort((a, b) =>
    a.creditorName.localeCompare(b.creditorName, 'es')
  )
}

export const reportsRoutes = new Elysia({ prefix: '/reports' })
  .use(authPlugin)
  .use(tenantPlugin)

  // ── GET /reports/creditors?year=&month=&payrollTypeId= ───────────────────
  .get(
    '/creditors',
    async ({ db, query, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }
      const year = Number.parseInt(query.year, 10)
      const month = Number.parseInt(query.month, 10)
      if (!Number.isInteger(year) || year < 1970 || year > 2100) {
        set.status = 400
        return { success: false, error: 'Año inválido.' }
      }
      if (!Number.isInteger(month) || month < 1 || month > 12) {
        set.status = 400
        return { success: false, error: 'Mes inválido (1..12).' }
      }

      const detail = await fetchCreditorReport(db, year, month, query.payrollTypeId)
      const summary = summarize(detail)
      const grandTotal = detail.reduce((s, r) => s + Number(r.amount), 0).toFixed(2)

      const { start, next } = monthRange(year, month)
      // The reported "to" is the last day of the requested month.
      const lastDay = new Date(`${next}T00:00:00Z`)
      lastDay.setUTCDate(lastDay.getUTCDate() - 1)
      const to = lastDay.toISOString().slice(0, 10)

      return {
        success: true,
        data: {
          year,
          month,
          rangeFrom: start,
          rangeTo: to,
          grandTotal,
          creditorCount: summary.length,
          installmentCount: detail.length,
          creditors: summary,
        },
      }
    },
    {
      beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('reports:loans.view')],
      query: t.Object({
        year: t.String(),
        month: t.String(),
        payrollTypeId: t.Optional(t.String()),
      }),
    }
  )
