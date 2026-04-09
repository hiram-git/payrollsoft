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

  it('skips whitespace', () => {
    const tokens = tokenize('  1  +  2  ')
    expect(tokens.map((t) => t.type)).toEqual(['NUMBER', 'PLUS', 'NUMBER', 'EOF'])
  })
})
