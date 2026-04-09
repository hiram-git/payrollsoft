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

export type ASTNode = NumberNode | StringNode | VariableNode | CallNode | BinaryOpNode | UnaryOpNode

// ─── Formula Context ──────────────────────────────────────────────────────────

export type FormulaContext = {
  employee: {
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
   * Async loader: returns the sum of `concept` over the last `periods` payroll periods.
   * Implement against the DB in Phase 3; use a stub that returns 0 for testing.
   */
  loadAccumulated: (code: string, periods: number) => Promise<number>
  /**
   * Async loader: returns a balance (loan balance, vacation balance, etc.)
   * by a string key. Implement against the DB in Phase 3.
   */
  loadBalance: (type: string) => Promise<number>
}

// ─── Engine Result ────────────────────────────────────────────────────────────

export type FormulaResult = {
  value: number
  error?: string
}
