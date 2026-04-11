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

/**
 * Resolve a variable name against the context.
 * Order: built-in aliases → concepts → employee custom fields.
 */
function resolveVariable(name: string, ctx: FormulaContext): number | undefined {
  const aliases: Record<string, number> = {
    SALARIO: ctx.employee.baseSalary,
    BASESALARY: ctx.employee.baseSalary,
    SALARIO_DIARIO: ctx.employee.baseSalary / 30,
    DIAS_PERIODO: ctx.period.totalDays,
    DIAS_TRABAJADOS: ctx.attendance.workedDays,
    DIAS_HABILES: ctx.attendance.businessDays,
    DIAS_AUSENCIA: ctx.attendance.absenceDays,
    MINUTOS_TARDANZA: ctx.attendance.lateMinutes,
    MINUTOS_EXTRA: ctx.attendance.overtimeMinutes,
    HORAS_EXTRA: ctx.attendance.overtimeMinutes / 60,
  }

  if (name in aliases) return aliases[name]

  // Concept lookup (e.g. variable named after a concept code)
  if (name in ctx.concepts) return ctx.concepts[name]

  // Employee custom fields
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
