import { FUNCTIONS } from './functions'
import type { ASTNode, FormulaContext } from './types'

type EvalValue = number | string

/**
 * Evaluate an AST node recursively, resolving variables and function calls
 * against the provided FormulaContext.
 *
 * All built-in functions that touch the DB (ACUMULADOS, SALDO) are async;
 * the evaluator is therefore fully async even for simple arithmetic.
 */
export async function evaluate(node: ASTNode, ctx: FormulaContext): Promise<EvalValue> {
  switch (node.type) {
    case 'Number':
      return node.value

    case 'String':
      return node.value

    case 'Variable': {
      const val = resolveVariable(node.name, ctx)
      if (val === undefined) {
        throw new Error(`Unknown variable: '${node.name}'`)
      }
      return val
    }

    case 'Call': {
      const fn = FUNCTIONS[node.name]
      if (!fn) throw new Error(`Unknown function: '${node.name}()'`)
      // Evaluate all arguments first, then invoke the function
      const args = await Promise.all(node.args.map((arg) => evaluate(arg, ctx)))
      return fn(args, ctx)
    }

    case 'UnaryOp': {
      const val = await evaluate(node.operand, ctx)
      if (typeof val !== 'number') throw new Error('Unary operator requires a number')
      return node.op === '-' ? -val : val
    }

    case 'BinaryOp': {
      const left = await evaluate(node.left, ctx)
      const right = await evaluate(node.right, ctx)
      return applyBinaryOp(node.op, left, right)
    }
  }
}

/** Format a Date as a comparable YYYYMMDD integer (e.g. 20240115). */
function toYMD(d: Date): number {
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate()
}

/** Days between two dates (absolute). */
function daysBetween(a: Date, b: Date): number {
  return Math.abs(Math.round((b.getTime() - a.getTime()) / 86_400_000))
}

/**
 * Resolve a variable name against the context.
 * Order: numeric built-ins → string built-ins → concepts → employee custom fields.
 * Dates are expressed as YYYYMMDD integers so arithmetic comparisons work naturally.
 */
function resolveVariable(name: string, ctx: FormulaContext): number | string | undefined {
  const refDate = ctx.period.start
  const antiguedadDias = daysBetween(ctx.employee.hireDate, refDate)

  const paymentDateYMD = ctx.payroll?.paymentDate ? toYMD(new Date(ctx.payroll.paymentDate)) : 0

  // XIII mes: effective days worked in the current period accounting for hire date
  // - Hired on/before period start → full period days
  // - Hired during period → days from hire to period end (inclusive)
  // - Hired after period end → 0
  const hireTime = ctx.employee.hireDate.getTime()
  const periodStartTime = ctx.period.start.getTime()
  const periodEndTime = ctx.period.end.getTime()
  const diasHabilesXIII =
    hireTime <= periodStartTime
      ? ctx.period.totalDays
      : hireTime > periodEndTime
        ? 0
        : Math.round((periodEndTime - hireTime) / 86_400_000) + 1

  // ── Numeric variables ──────────────────────────────────────────────────────
  const numeric: Record<string, number> = {
    // Salary
    SALARIO: ctx.employee.baseSalary,
    SUELDO: ctx.employee.baseSalary,
    BASESALARY: ctx.employee.baseSalary,
    SALARIO_DIARIO: ctx.employee.baseSalary / 30,
    // Period / attendance
    DIAS_PERIODO: ctx.period.totalDays,
    DIAS_TRABAJADOS: ctx.attendance.workedDays,
    DIAS_HABILES: ctx.attendance.businessDays,
    DIAS_AUSENCIA: ctx.attendance.absenceDays,
    MINUTOS_TARDANZA: ctx.attendance.lateMinutes,
    MINUTOS_EXTRA: ctx.attendance.overtimeMinutes,
    HORAS_EXTRA: ctx.attendance.overtimeMinutes / 60,
    HORAS: ctx.attendance.workedDays * 8,
    // Seniority
    ANTIGUEDAD: antiguedadDias / 365,
    ANTIGUEDAD_DIAS: antiguedadDias,
    // Dates as YYYYMMDD
    FECHAINICIO: toYMD(ctx.period.start),
    FECHAFIN: toYMD(ctx.period.end),
    FECHAPAGO: paymentDateYMD,
    // Representation expenses (from custom fields, default 0)
    GASTOS_REP: Number(ctx.employee.customFields?.gastos_rep ?? 0),
    GASTOS_REPRESENTACION: Number(ctx.employee.customFields?.gastos_rep ?? 0),
    // XIII mes: effective calendar days worked in the period (respects hire date)
    DIAS_HABILES_XIII: diasHabilesXIII,
    DIAS_XIII: diasHabilesXIII, // alias
  }

  if (name in numeric) return numeric[name]

  // ── String variables ───────────────────────────────────────────────────────
  if (name === 'FICHA') return ctx.employee.code
  if (name === 'EMPLOYEE_ID') return ctx.employee.id

  // ── Concept lookup (code → computed amount) ────────────────────────────────
  if (name in ctx.concepts) return ctx.concepts[name]

  // ── Employee custom fields (fallback, case-insensitive key) ───────────────
  const cf = ctx.employee.customFields?.[name.toLowerCase()]
  if (typeof cf === 'number') return cf

  return undefined
}

/**
 * Apply a binary operator to two evaluated values.
 * All comparison operators return 1 (true) or 0 (false).
 */
function applyBinaryOp(op: string, left: EvalValue, right: EvalValue): number {
  const l = Number(left)
  const r = Number(right)

  switch (op) {
    case '+':
      return l + r
    case '-':
      return l - r
    case '*':
      return l * r
    case '/':
      if (r === 0) throw new Error('Division by zero')
      return l / r
    case '>':
      return l > r ? 1 : 0
    case '<':
      return l < r ? 1 : 0
    case '>=':
      return l >= r ? 1 : 0
    case '<=':
      return l <= r ? 1 : 0
    case '=':
      return l === r ? 1 : 0
    case '<>':
      return l !== r ? 1 : 0
    default:
      throw new Error(`Unknown operator: '${op}'`)
  }
}
