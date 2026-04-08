import { describe, expect, it } from 'bun:test'
import { parse } from '../parser'
import type { ASTNode } from '../types'

describe('Parser', () => {
  it('parses a number literal', () => {
    expect(parse('42')).toEqual({ type: 'Number', value: 42 })
  })

  it('parses a string literal', () => {
    expect(parse('"CODIGO"')).toEqual({ type: 'String', value: 'CODIGO' })
  })

  it('parses a variable', () => {
    expect(parse('SALARIO')).toEqual({ type: 'Variable', name: 'SALARIO' })
  })

  it('parses addition', () => {
    const ast = parse('1 + 2') as ASTNode
    expect(ast).toMatchObject({
      type: 'BinaryOp',
      op: '+',
      left: { type: 'Number', value: 1 },
      right: { type: 'Number', value: 2 },
    })
  })

  it('parses left-associative subtraction', () => {
    // 10 - 3 - 2  →  (10 - 3) - 2
    const ast = parse('10 - 3 - 2') as ASTNode
    expect(ast).toMatchObject({
      type: 'BinaryOp',
      op: '-',
      left: { type: 'BinaryOp', op: '-' },
      right: { type: 'Number', value: 2 },
    })
  })

  it('parses multiplication with higher precedence than addition', () => {
    // 2 + 3 * 4  →  2 + (3 * 4)
    const ast = parse('2 + 3 * 4') as ASTNode
    expect(ast).toMatchObject({
      type: 'BinaryOp',
      op: '+',
      left: { type: 'Number', value: 2 },
      right: { type: 'BinaryOp', op: '*' },
    })
  })

  it('parses parentheses overriding precedence', () => {
    // (2 + 3) * 4
    const ast = parse('(2 + 3) * 4') as ASTNode
    expect(ast).toMatchObject({
      type: 'BinaryOp',
      op: '*',
      left: { type: 'BinaryOp', op: '+' },
    })
  })

  it('parses unary negation', () => {
    const ast = parse('-5')
    expect(ast).toMatchObject({ type: 'UnaryOp', op: '-', operand: { type: 'Number', value: 5 } })
  })

  it('parses a function call with no args', () => {
    expect(parse('INIPERIODO()')).toMatchObject({ type: 'Call', name: 'INIPERIODO', args: [] })
  })

  it('parses a function call with one string arg', () => {
    expect(parse('CONCEPTO("HE")')).toMatchObject({
      type: 'Call',
      name: 'CONCEPTO',
      args: [{ type: 'String', value: 'HE' }],
    })
  })

  it('parses a nested function call', () => {
    // SI(SALARIO > 1000, 100, 50)
    const ast = parse('SI(SALARIO > 1000, 100, 50)')
    expect(ast).toMatchObject({
      type: 'Call',
      name: 'SI',
      args: [
        { type: 'BinaryOp', op: '>' },
        { type: 'Number', value: 100 },
        { type: 'Number', value: 50 },
      ],
    })
  })

  it('parses comparison operators', () => {
    expect(parse('A >= B')).toMatchObject({ type: 'BinaryOp', op: '>=' })
    expect(parse('A <> B')).toMatchObject({ type: 'BinaryOp', op: '<>' })
    expect(parse('A = B')).toMatchObject({ type: 'BinaryOp', op: '=' })
  })

  it('throws on unexpected token', () => {
    expect(() => parse('1 +')).toThrow()
  })

  it('throws on unknown token after expression', () => {
    expect(() => parse('1 2')).toThrow("Unexpected token '2'")
  })
})
