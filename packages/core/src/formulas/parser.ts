import { tokenize } from './lexer'
import type { ASTNode, Token, TokenType } from './types'

/**
 * Recursive-descent parser for payroll formula expressions.
 *
 * Single-line mode (no newlines in input) — backwards-compatible:
 *   expr         → comparison
 *   comparison   → addition  (('>' | '<' | '>=' | '<=' | '=' | '<>') addition)*
 *   addition     → multiply  (('+' | '-') multiply)*
 *   multiply     → unary     (('*' | '/') unary)*
 *   unary        → '-' unary | primary
 *   primary      → NUMBER | STRING | IDENTIFIER ['(' args ')'] | '(' expr ')'
 *   args         → (expr (',' expr)*)?
 *
 * Multi-line mode (input contains '\n') — user-defined variables:
 *   program      → statement (NEWLINE+ statement)* NEWLINE* EOF
 *   statement    → IDENTIFIER '=' expr   (assignment)
 *                | expr                  (expression — last one is the result)
 *
 * In multi-line mode '=' at the start of a statement is assignment, not comparison.
 * Inside any expression (including assignment RHS) '=' remains equality comparison.
 */
class Parser {
  private readonly tokens: Token[]
  private pos = 0

  constructor(input: string) {
    this.tokens = tokenize(input)
  }

  // ── Token helpers ────────────────────────────────────────────────────────

  private peek(): Token {
    return this.tokens[this.pos]
  }

  private peekAt(offset: number): Token {
    return this.tokens[Math.min(this.pos + offset, this.tokens.length - 1)]
  }

  private consume(expected?: TokenType): Token {
    const tok = this.tokens[this.pos]
    if (expected && tok.type !== expected) {
      throw new Error(
        `Expected '${expected}' but found '${tok.value}' (${tok.type}) at position ${tok.pos}`
      )
    }
    this.pos++
    return tok
  }

  private match(...types: TokenType[]): boolean {
    return types.includes(this.peek().type)
  }

  private skipNewlines(): void {
    while (this.peek().type === 'NEWLINE') this.pos++
  }

  // ── Top-level entry ──────────────────────────────────────────────────────

  parse(): ASTNode {
    const hasNewlines = this.tokens.some((t) => t.type === 'NEWLINE')
    if (hasNewlines) return this.parseProgram()

    const node = this.parseComparison()
    if (this.peek().type !== 'EOF') {
      throw new Error(`Unexpected token '${this.peek().value}' at position ${this.peek().pos}`)
    }
    return node
  }

  // ── Multi-line program ───────────────────────────────────────────────────

  private parseProgram(): ASTNode {
    const body: ASTNode[] = []

    this.skipNewlines()
    while (this.peek().type !== 'EOF') {
      body.push(this.parseStatement())
      if (this.peek().type !== 'EOF' && this.peek().type !== 'NEWLINE') {
        throw new Error(
          `Expected newline after statement, found '${this.peek().value}' at position ${this.peek().pos}`
        )
      }
      this.skipNewlines()
    }

    if (body.length === 0) throw new Error('Empty formula')
    return { type: 'Program', body }
  }

  /** Parse one statement: assignment (`name = expr`) or bare expression. */
  private parseStatement(): ASTNode {
    // Assignment: IDENTIFIER immediately followed by '=' (but not '>=', '<=', '<>')
    // peekAt(1) is the token AFTER the identifier — only EQ (single '=') qualifies.
    if (this.peek().type === 'IDENTIFIER' && this.peekAt(1).type === 'EQ') {
      const name = this.consume('IDENTIFIER').value
      this.consume('EQ')
      const value = this.parseComparison()
      return { type: 'Assignment', name, value }
    }
    return this.parseComparison()
  }

  // ── Grammar rules (expression level) ────────────────────────────────────

  private parseComparison(): ASTNode {
    let left = this.parseAddition()
    while (this.match('GT', 'LT', 'GTE', 'LTE', 'EQ', 'NEQ')) {
      const op = this.consume().value
      left = { type: 'BinaryOp', op, left, right: this.parseAddition() }
    }
    return left
  }

  private parseAddition(): ASTNode {
    let left = this.parseMultiplication()
    while (this.match('PLUS', 'MINUS')) {
      const op = this.consume().value
      left = { type: 'BinaryOp', op, left, right: this.parseMultiplication() }
    }
    return left
  }

  private parseMultiplication(): ASTNode {
    let left = this.parseUnary()
    while (this.match('MULTIPLY', 'DIVIDE')) {
      const op = this.consume().value
      left = { type: 'BinaryOp', op, left, right: this.parseUnary() }
    }
    return left
  }

  private parseUnary(): ASTNode {
    if (this.match('MINUS')) {
      this.consume()
      return { type: 'UnaryOp', op: '-', operand: this.parsePrimary() }
    }
    return this.parsePrimary()
  }

  private parsePrimary(): ASTNode {
    const tok = this.peek()

    if (tok.type === 'NUMBER') {
      this.consume()
      return { type: 'Number', value: Number.parseFloat(tok.value) }
    }

    if (tok.type === 'STRING') {
      this.consume()
      return { type: 'String', value: tok.value }
    }

    if (tok.type === 'IDENTIFIER') {
      this.consume()
      // Function call: IDENTIFIER '(' args ')'
      if (this.peek().type === 'LPAREN') {
        this.consume('LPAREN')
        const args: ASTNode[] = []
        while (!this.match('RPAREN')) {
          if (args.length > 0) this.consume('COMMA')
          args.push(this.parseComparison())
        }
        this.consume('RPAREN')
        return { type: 'Call', name: tok.value, args }
      }
      // Variable reference
      return { type: 'Variable', name: tok.value }
    }

    if (tok.type === 'LPAREN') {
      this.consume()
      const inner = this.parseComparison()
      this.consume('RPAREN')
      return inner
    }

    throw new Error(`Unexpected token '${tok.value}' (${tok.type}) at position ${tok.pos}`)
  }
}

export function parse(formula: string): ASTNode {
  return new Parser(formula).parse()
}
