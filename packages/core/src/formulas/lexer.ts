import type { Token, TokenType } from './types'

const SINGLE_OPS: Record<string, TokenType> = {
  '+': 'PLUS',
  '-': 'MINUS',
  '*': 'MULTIPLY',
  '/': 'DIVIDE',
  '(': 'LPAREN',
  ')': 'RPAREN',
  ',': 'COMMA',
}

/**
 * Tokenize a formula string into a flat list of tokens.
 * Identifiers are uppercased so the language is case-insensitive.
 *
 * Supported literals:
 *   - Numbers: 42, 3.14, .5
 *   - Strings: "text" or 'text'  (no escape sequences needed for payroll use)
 *   - Identifiers / keywords: SALARIO, SI, CONCEPTO, etc.
 *
 * Supported operators: + - * / ( ) , > < >= <= = <>
 */
export function tokenize(input: string): Token[] {
  const tokens: Token[] = []
  let pos = 0

  while (pos < input.length) {
    // Newlines are statement separators — emit a single NEWLINE token per run
    if (input[pos] === '\r') {
      pos++
      continue
    } // strip CR from CRLF
    if (input[pos] === '\n') {
      // Collapse consecutive newlines into one token
      if (tokens.length > 0 && tokens[tokens.length - 1].type !== 'NEWLINE') {
        tokens.push({ type: 'NEWLINE', value: '\n', pos })
      }
      pos++
      continue
    }
    // Other whitespace (spaces, tabs)
    if (input[pos] === ' ' || input[pos] === '\t') {
      pos++
      continue
    }

    // Numbers: digits or leading dot (e.g. .5)
    if (/\d/.test(input[pos]) || (input[pos] === '.' && /\d/.test(input[pos + 1] ?? ''))) {
      const start = pos
      let num = ''
      while (pos < input.length && /[\d.]/.test(input[pos])) {
        num += input[pos++]
      }
      tokens.push({ type: 'NUMBER', value: num, pos: start })
      continue
    }

    // Strings: "..." or '...'
    if (input[pos] === '"' || input[pos] === "'") {
      const start = pos
      const quote = input[pos++]
      let str = ''
      while (pos < input.length && input[pos] !== quote) {
        str += input[pos++]
      }
      if (pos >= input.length) {
        throw new Error(`Unterminated string starting at position ${start}`)
      }
      pos++ // skip closing quote
      tokens.push({ type: 'STRING', value: str, pos: start })
      continue
    }

    // Two-char operators (must check before single-char)
    const two = input.slice(pos, pos + 2)
    if (two === '>=') {
      tokens.push({ type: 'GTE', value: '>=', pos })
      pos += 2
      continue
    }
    if (two === '<=') {
      tokens.push({ type: 'LTE', value: '<=', pos })
      pos += 2
      continue
    }
    if (two === '<>') {
      tokens.push({ type: 'NEQ', value: '<>', pos })
      pos += 2
      continue
    }

    // Single-char comparison operators
    if (input[pos] === '>') {
      tokens.push({ type: 'GT', value: '>', pos })
      pos++
      continue
    }
    if (input[pos] === '<') {
      tokens.push({ type: 'LT', value: '<', pos })
      pos++
      continue
    }
    if (input[pos] === '=') {
      tokens.push({ type: 'EQ', value: '=', pos })
      pos++
      continue
    }

    // Arithmetic / punctuation
    const singleType = SINGLE_OPS[input[pos]]
    if (singleType) {
      tokens.push({ type: singleType, value: input[pos], pos })
      pos++
      continue
    }

    // Identifiers and keywords — uppercased for case-insensitivity
    if (/[a-zA-Z_]/.test(input[pos])) {
      const start = pos
      let id = ''
      while (pos < input.length && /[\w]/.test(input[pos])) {
        id += input[pos++]
      }
      tokens.push({ type: 'IDENTIFIER', value: id.toUpperCase(), pos: start })
      continue
    }

    throw new Error(`Unexpected character '${input[pos]}' at position ${pos}`)
  }

  tokens.push({ type: 'EOF', value: '', pos })
  return tokens
}
