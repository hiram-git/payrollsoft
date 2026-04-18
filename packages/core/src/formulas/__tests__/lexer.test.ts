import { describe, expect, it } from 'bun:test'
import { tokenize } from '../lexer'

describe('Lexer', () => {
  it('tokenizes a simple number', () => {
    const tokens = tokenize('42')
    expect(tokens[0]).toMatchObject({ type: 'NUMBER', value: '42' })
    expect(tokens[1].type).toBe('EOF')
  })

  it('tokenizes a decimal number', () => {
    const [tok] = tokenize('3.14')
    expect(tok).toMatchObject({ type: 'NUMBER', value: '3.14' })
  })

  it('tokenizes a double-quoted string', () => {
    const [tok] = tokenize('"HORA_EXTRA"')
    expect(tok).toMatchObject({ type: 'STRING', value: 'HORA_EXTRA' })
  })

  it('tokenizes a single-quoted string', () => {
    const [tok] = tokenize("'PRESTAMO'")
    expect(tok).toMatchObject({ type: 'STRING', value: 'PRESTAMO' })
  })

  it('uppercases identifiers', () => {
    const [tok] = tokenize('salario')
    expect(tok).toMatchObject({ type: 'IDENTIFIER', value: 'SALARIO' })
  })

  it('tokenizes arithmetic operators', () => {
    const tokens = tokenize('+ - * /')
    expect(tokens.map((t) => t.type)).toEqual(['PLUS', 'MINUS', 'MULTIPLY', 'DIVIDE', 'EOF'])
  })

  it('tokenizes comparison operators', () => {
    const tokens = tokenize('> < >= <= = <>')
    expect(tokens.map((t) => t.type)).toEqual(['GT', 'LT', 'GTE', 'LTE', 'EQ', 'NEQ', 'EOF'])
  })

  it('tokenizes a full formula', () => {
    const tokens = tokenize('SALARIO / 30 * DIAS("TRABAJADOS")')
    expect(tokens.map((t) => t.type)).toEqual([
      'IDENTIFIER', // SALARIO
      'DIVIDE',
      'NUMBER', // 30
      'MULTIPLY',
      'IDENTIFIER', // DIAS
      'LPAREN',
      'STRING', // TRABAJADOS
      'RPAREN',
      'EOF',
    ])
  })

  it('throws on unexpected character', () => {
    expect(() => tokenize('SALARIO @ 30')).toThrow("Unexpected character '@'")
  })

  it('throws on unterminated string', () => {
    expect(() => tokenize('"unclosed')).toThrow('Unterminated string')
  })

  it('skips spaces and tabs', () => {
    const tokens = tokenize('  1  +  2  ')
    expect(tokens.map((t) => t.type)).toEqual(['NUMBER', 'PLUS', 'NUMBER', 'EOF'])
  })

  it('emits NEWLINE for line breaks', () => {
    const tokens = tokenize('a\nb')
    expect(tokens.map((t) => t.type)).toEqual(['IDENTIFIER', 'NEWLINE', 'IDENTIFIER', 'EOF'])
  })

  it('collapses consecutive newlines into one NEWLINE token', () => {
    const tokens = tokenize('a\n\n\nb')
    expect(tokens.map((t) => t.type)).toEqual(['IDENTIFIER', 'NEWLINE', 'IDENTIFIER', 'EOF'])
  })

  it('handles CRLF line endings', () => {
    const tokens = tokenize('a\r\nb')
    expect(tokens.map((t) => t.type)).toEqual(['IDENTIFIER', 'NEWLINE', 'IDENTIFIER', 'EOF'])
  })

  it('does not emit leading NEWLINE at start of input', () => {
    const tokens = tokenize('\na + b')
    // leading newline produces a NEWLINE before the first real token only if
    // there is already a token — since there is none, no NEWLINE is emitted
    expect(tokens[0].type).not.toBe('NEWLINE')
  })
})
