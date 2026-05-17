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

  // ── GET /reports/employee-files ──────────────────────────────────────────
  //
  // Reporte gerencial de movimientos de expedientes. Devuelve la
  // cantidad total y siete agrupaciones precomputadas para que la UI
  // las renderice en una sola página (tipo, subtipo, usuario,
  // empleado, departamento, función, cargo, mes).
  //
  // Todas las queries comparten los mismos filtros opcionales
  // (rango de fechas, tipo, subtipo, empleado, departamento, etc.);
  // se ejecutan en paralelo via `Promise.all`. Pensado para que un
  // jefe de RRHH vea la distribución del trabajo en un período sin
  // exportar nada.
  .get(
    '/employee-files',
    async ({ db, query, set }) => {
      if (!db) {
        set.status = 400
        return { success: false, error: 'Tenant required' }
      }

      const from = (query.from ?? '').trim() || null
      const to = (query.to ?? '').trim() || null
      const filters = {
        typeId: query.typeId ? Number.parseInt(query.typeId, 10) : null,
        subtypeId: query.subtypeId ? Number.parseInt(query.subtypeId, 10) : null,
        employeeId: query.employeeId?.trim() || null,
        departamentoId: query.departamentoId?.trim() || null,
        funcionId: query.funcionId?.trim() || null,
        cargoId: query.cargoId?.trim() || null,
        createdBy: query.createdBy?.trim() || null,
      }

      // Construcción de WHERE compartido. Usamos parámetros de Drizzle
      // (`sql.raw` solo para los nombres de columna) y `sql.empty()`
      // como no-op cuando el filtro no aplica.
      const where = (alias = 'ef') => {
        const parts = [sql.raw('1=1')]
        if (from) parts.push(sql`${sql.raw(alias)}.document_date >= ${from}::date`)
        if (to) parts.push(sql`${sql.raw(alias)}.document_date <= ${to}::date`)
        if (filters.typeId) parts.push(sql`${sql.raw(alias)}.type_id = ${filters.typeId}`)
        if (filters.subtypeId) parts.push(sql`${sql.raw(alias)}.subtype_id = ${filters.subtypeId}`)
        if (filters.employeeId)
          parts.push(sql`${sql.raw(alias)}.employee_id = ${filters.employeeId}::uuid`)
        if (filters.createdBy)
          parts.push(sql`${sql.raw(alias)}.created_by = ${filters.createdBy}::uuid`)
        return sql.join(parts, sql` AND `)
      }
      const empJoinFilters = sql.join(
        [
          filters.departamentoId
            ? sql`e.departamento_id = ${filters.departamentoId}::uuid`
            : sql.raw('1=1'),
          filters.funcionId ? sql`e.funcion_id = ${filters.funcionId}::uuid` : sql.raw('1=1'),
          filters.cargoId ? sql`e.cargo_id = ${filters.cargoId}::uuid` : sql.raw('1=1'),
        ],
        sql` AND `
      )

      const [
        totalRows,
        byTypeRows,
        bySubtypeRows,
        byUserRows,
        byEmployeeRows,
        byDeptRows,
        byFuncionRows,
        byCargoRows,
        byMonthRows,
      ] = await Promise.all([
        db.execute(sql`
          SELECT COUNT(*)::int AS total
          FROM employee_files ef
          JOIN employees e ON e.id = ef.employee_id
          WHERE ${where()} AND ${empJoinFilters}
        `),
        db.execute(sql`
          SELECT t.id AS type_id, t.name AS type_name, COUNT(*)::int AS count
          FROM employee_files ef
          JOIN employees e ON e.id = ef.employee_id
          JOIN employee_file_types t ON t.id = ef.type_id
          WHERE ${where()} AND ${empJoinFilters}
          GROUP BY t.id, t.name
          ORDER BY count DESC, t.name ASC
        `),
        db.execute(sql`
          SELECT t.id AS type_id, t.name AS type_name,
                 s.id AS subtype_id, s.name AS subtype_name, COUNT(*)::int AS count
          FROM employee_files ef
          JOIN employees e ON e.id = ef.employee_id
          JOIN employee_file_types t ON t.id = ef.type_id
          JOIN employee_file_subtypes s ON s.id = ef.subtype_id
          WHERE ${where()} AND ${empJoinFilters}
          GROUP BY t.id, t.name, s.id, s.name
          ORDER BY count DESC, t.name ASC, s.name ASC
        `),
        db.execute(sql`
          SELECT ef.created_by AS user_id, COUNT(*)::int AS count
          FROM employee_files ef
          JOIN employees e ON e.id = ef.employee_id
          WHERE ${where()} AND ${empJoinFilters}
          GROUP BY ef.created_by
          ORDER BY count DESC
        `),
        db.execute(sql`
          SELECT e.id AS employee_id, e.code AS employee_code,
                 e.first_name, e.last_name, COUNT(*)::int AS count
          FROM employee_files ef
          JOIN employees e ON e.id = ef.employee_id
          WHERE ${where()} AND ${empJoinFilters}
          GROUP BY e.id, e.code, e.first_name, e.last_name
          ORDER BY count DESC, e.last_name ASC, e.first_name ASC
        `),
        db.execute(sql`
          SELECT e.departamento_id AS departamento_id,
                 COALESCE(d.name, '— Sin departamento') AS departamento_name,
                 COUNT(*)::int AS count
          FROM employee_files ef
          JOIN employees e ON e.id = ef.employee_id
          LEFT JOIN departamentos d ON d.id = e.departamento_id
          WHERE ${where()} AND ${empJoinFilters}
          GROUP BY e.departamento_id, d.name
          ORDER BY count DESC, d.name ASC
        `),
        db.execute(sql`
          SELECT e.funcion_id AS funcion_id,
                 COALESCE(f.name, '— Sin función') AS funcion_name,
                 COUNT(*)::int AS count
          FROM employee_files ef
          JOIN employees e ON e.id = ef.employee_id
          LEFT JOIN funciones f ON f.id = e.funcion_id
          WHERE ${where()} AND ${empJoinFilters}
          GROUP BY e.funcion_id, f.name
          ORDER BY count DESC, f.name ASC
        `),
        db.execute(sql`
          SELECT e.cargo_id AS cargo_id,
                 COALESCE(c.name, '— Sin cargo') AS cargo_name,
                 COUNT(*)::int AS count
          FROM employee_files ef
          JOIN employees e ON e.id = ef.employee_id
          LEFT JOIN cargos c ON c.id = e.cargo_id
          WHERE ${where()} AND ${empJoinFilters}
          GROUP BY e.cargo_id, c.name
          ORDER BY count DESC, c.name ASC
        `),
        db.execute(sql`
          SELECT TO_CHAR(ef.document_date, 'YYYY-MM') AS ym, COUNT(*)::int AS count
          FROM employee_files ef
          JOIN employees e ON e.id = ef.employee_id
          WHERE ${where()} AND ${empJoinFilters}
          GROUP BY ym
          ORDER BY ym ASC
        `),
      ])

      // Resolver nombres de usuarios — los expedientes guardan
      // created_by como uuid (FK lógica al schema payroll_auth.users
      // o users del tenant). Hacemos un join "manual" para no
      // ensuciar las 8 queries de arriba.
      const userRowsRaw = byUserRows as unknown as Array<{ user_id: string | null; count: number }>
      const userIds = Array.from(
        new Set(userRowsRaw.map((r) => r.user_id).filter(Boolean))
      ) as string[]
      let userNameMap = new Map<string, string>()
      if (userIds.length > 0) {
        try {
          const userRows = (await db.execute(sql`
            SELECT id, COALESCE(name, email, '—') AS display
            FROM payroll_auth.users
            WHERE id = ANY(${userIds}::uuid[])
          `)) as unknown as Array<{ id: string; display: string }>
          userNameMap = new Map(userRows.map((r) => [String(r.id), String(r.display)]))
        } catch {
          /* tabla puede no estar accesible desde el tenant; degradamos a uuid */
        }
      }

      return {
        success: true,
        data: {
          range: { from, to },
          filters,
          total: Number((totalRows as Array<{ total: number }>)[0]?.total ?? 0),
          byType: (byTypeRows as unknown as Array<Record<string, unknown>>).map((r) => ({
            typeId: Number(r.type_id),
            typeName: String(r.type_name),
            count: Number(r.count),
          })),
          bySubtype: (bySubtypeRows as unknown as Array<Record<string, unknown>>).map((r) => ({
            typeId: Number(r.type_id),
            typeName: String(r.type_name),
            subtypeId: Number(r.subtype_id),
            subtypeName: String(r.subtype_name),
            count: Number(r.count),
          })),
          byUser: userRowsRaw.map((r) => ({
            userId: r.user_id,
            userName: r.user_id
              ? (userNameMap.get(r.user_id) ?? r.user_id.slice(0, 8))
              : '— Sistema',
            count: r.count,
          })),
          byEmployee: (byEmployeeRows as unknown as Array<Record<string, unknown>>).map((r) => ({
            employeeId: String(r.employee_id),
            employeeCode: String(r.employee_code),
            firstName: String(r.first_name),
            lastName: String(r.last_name),
            count: Number(r.count),
          })),
          byDepartamento: (byDeptRows as unknown as Array<Record<string, unknown>>).map((r) => ({
            departamentoId: r.departamento_id ? String(r.departamento_id) : null,
            departamentoName: String(r.departamento_name),
            count: Number(r.count),
          })),
          byFuncion: (byFuncionRows as unknown as Array<Record<string, unknown>>).map((r) => ({
            funcionId: r.funcion_id ? String(r.funcion_id) : null,
            funcionName: String(r.funcion_name),
            count: Number(r.count),
          })),
          byCargo: (byCargoRows as unknown as Array<Record<string, unknown>>).map((r) => ({
            cargoId: r.cargo_id ? String(r.cargo_id) : null,
            cargoName: String(r.cargo_name),
            count: Number(r.count),
          })),
          byMonth: (byMonthRows as unknown as Array<Record<string, unknown>>).map((r) => ({
            ym: String(r.ym),
            count: Number(r.count),
          })),
        },
      }
    },
    {
      beforeHandle: [guardAuth, guardTenantMatchesToken, guardPermission('employee_files:read')],
      query: t.Object({
        from: t.Optional(t.String()),
        to: t.Optional(t.String()),
        typeId: t.Optional(t.String()),
        subtypeId: t.Optional(t.String()),
        employeeId: t.Optional(t.String()),
        departamentoId: t.Optional(t.String()),
        funcionId: t.Optional(t.String()),
        cargoId: t.Optional(t.String()),
        createdBy: t.Optional(t.String()),
      }),
    }
  )
