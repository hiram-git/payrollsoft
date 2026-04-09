import { tokenize } from './lexer'
import type { ASTNode, Token, TokenType } from './types'

/**
 * Recursive-descent parser for payroll formula expressions.
 *
 * Grammar (precedence, lowest → highest):
 *   expr         → comparison
 *   comparison   → addition  (('>' | '<' | '>=' | '<=' | '=' | '<>') addition)*
 *   addition     → multiply  (('+' | '-') multiply)*
 *   multiply     → unary     (('*' | '/') unary)*
 *   unary        → '-' unary | primary
 *   primary      → NUMBER | STRING | IDENTIFIER ['(' args ')'] | '(' expr ')'
 *   args         → (expr (',' expr)*)?
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

  // ── Grammar rules ────────────────────────────────────────────────────────

  parse(): ASTNode {
    const node = this.parseComparison()
    if (this.peek().type !== 'EOF') {
      throw new Error(`Unexpected token '${this.peek().value}' at position ${this.peek().pos}`)
    }
    return node
  }

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
