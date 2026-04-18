// ─── Lexer ────────────────────────────────────────────────────────────────────

export type TokenType =
  | 'NUMBER'
  | 'STRING'
  | 'IDENTIFIER'
  | 'LPAREN'
  | 'RPAREN'
  | 'COMMA'
  | 'PLUS'
  | 'MINUS'
  | 'MULTIPLY'
  | 'DIVIDE'
  | 'GT'
  | 'LT'
  | 'GTE'
  | 'LTE'
  | 'EQ'
  | 'NEQ'
  | 'NEWLINE'
  | 'EOF'

export type Token = {
  type: TokenType
  value: string
  pos: number
}

// ─── AST ──────────────────────────────────────────────────────────────────────

export type NumberNode = { type: 'Number'; value: number }
export type StringNode = { type: 'String'; value: string }
export type VariableNode = { type: 'Variable'; name: string }
export type CallNode = { type: 'Call'; name: string; args: ASTNode[] }
export type BinaryOpNode = { type: 'BinaryOp'; op: string; left: ASTNode; right: ASTNode }
export type UnaryOpNode = { type: 'UnaryOp'; op: string; operand: ASTNode }

/** User-defined variable assignment: `name = expression` (multi-line formulas only) */
export type AssignmentNode = { type: 'Assignment'; name: string; value: ASTNode }

/**
 * A multi-statement formula program. Each item in `body` is either an
 * AssignmentNode or any expression node. The result is the last statement's value.
 */
export type ProgramNode = { type: 'Program'; body: ASTNode[] }

export type ASTNode =
  | NumberNode
  | StringNode
  | VariableNode
  | CallNode
  | BinaryOpNode
  | UnaryOpNode
  | AssignmentNode
  | ProgramNode

// ─── Formula Context ──────────────────────────────────────────────────────────

export type FormulaContext = {
  employee: {
    id: string
    code: string
    baseSalary: number
    hireDate: Date
    customFields?: Record<string, unknown>
  }
  period: {
    start: Date
    end: Date
    totalDays: number
    type: 'biweekly' | 'monthly' | 'weekly'
  }
  payroll?: {
    paymentDate: string | null
  }
  attendance: {
    workedDays: number
    businessDays: number
    lateMinutes: number
    overtimeMinutes: number
    absenceDays: number
  }
  /** Resolved concept values within the current payroll line (code → amount) */
  concepts: Record<string, number>
  /**
   * Async loader: returns the sum of `concept` over the last `periods` closed payrolls.
   * Implement against the DB in Phase 3; use a stub that returns 0 for testing.
   */
  loadAccumulated: (code: string, periods: number) => Promise<number>
  /**
   * Async loader: returns the sum of `concept` across closed payrolls whose period
   * falls within [from, to] (YYYY-MM-DD strings). Used by XIII mes formulas.
   */
  loadAccumulatedByDateRange: (code: string, from: string, to: string) => Promise<number>
  /**
   * Async loader: returns a balance (loan balance, vacation balance, etc.)
   * by a string key. Implement against the DB in Phase 3.
   */
  loadBalance: (type: string) => Promise<number>
  /**
   * Async loader: returns the sum of loan installments for the current employee
   * linked to a specific creditor (by code) within the given period [from, to].
   * Used by CUOTA_ACREEDOR().
   */
  loadInstallmentsByCreditor: (creditorCode: string, from: string, to: string) => Promise<number>
}

// ─── Engine Result ────────────────────────────────────────────────────────────

export type FormulaResult = {
  value: number
  error?: string
}
