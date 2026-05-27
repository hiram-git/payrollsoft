import { describe, expect, test } from 'bun:test'
import * as XLSX from 'xlsx'
import { generateCheckXlsx } from '../check-xlsx'

describe('generateCheckXlsx', () => {
  test('produce un xlsx parseable con la hoja "Cheques"', () => {
    const buf = generateCheckXlsx([
      {
        checkNumber: 12345,
        issueDate: '2026-01-15',
        beneficiaryName: 'PEREZ JUAN',
        amount: 1234.5,
      },
    ])
    expect(buf.byteLength).toBeGreaterThan(500)
    const wb = XLSX.read(buf, { type: 'buffer' })
    expect(wb.SheetNames).toContain('Cheques')
  })

  test('persiste número de cheque pad-leado a 7 dígitos', () => {
    const buf = generateCheckXlsx([
      {
        checkNumber: 42,
        issueDate: '2026-01-15',
        beneficiaryName: 'X',
        amount: 100,
      },
    ])
    const wb = XLSX.read(buf, { type: 'buffer' })
    const sheet = wb.Sheets.Cheques
    const cells = Object.entries(sheet)
      .filter(([k]) => k.startsWith('J'))
      .map(([, v]) => (v as { v: string }).v)
    expect(cells).toContain('0000042')
  })

  test('persiste nombre del beneficiario y monto en letras', () => {
    const buf = generateCheckXlsx([
      {
        checkNumber: 1,
        issueDate: '2026-01-15',
        beneficiaryName: 'ACME CORP',
        amount: 500.75,
      },
    ])
    const wb = XLSX.read(buf, { type: 'buffer' })
    const sheet = wb.Sheets.Cheques
    const values = Object.values(sheet)
      .map((c) => (typeof c === 'object' && c && 'v' in c ? c.v : null))
      .filter((v): v is string => typeof v === 'string')
    expect(values).toContain('ACME CORP')
    // El monto en letras se renderiza con dobles asteriscos.
    expect(values.some((v) => v.includes('QUINIENTOS') && v.includes('75/100'))).toBe(true)
  })

  test('usa amountInWords cuando viene precalculado', () => {
    const buf = generateCheckXlsx([
      {
        checkNumber: 1,
        issueDate: '2026-01-15',
        beneficiaryName: 'X',
        amount: 100,
        amountInWords: 'TEXTO CUSTOM PERSISTIDO',
      },
    ])
    const wb = XLSX.read(buf, { type: 'buffer' })
    const values = Object.values(wb.Sheets.Cheques)
      .map((c) => (typeof c === 'object' && c && 'v' in c ? c.v : null))
      .filter((v): v is string => typeof v === 'string')
    expect(values.some((v) => v.includes('TEXTO CUSTOM PERSISTIDO'))).toBe(true)
  })

  test('múltiples cheques se apilan en la misma hoja', () => {
    const buf = generateCheckXlsx([
      { checkNumber: 1, issueDate: '2026-01-15', beneficiaryName: 'A', amount: 100 },
      { checkNumber: 2, issueDate: '2026-01-15', beneficiaryName: 'B', amount: 200 },
      { checkNumber: 3, issueDate: '2026-01-15', beneficiaryName: 'C', amount: 300 },
    ])
    const wb = XLSX.read(buf, { type: 'buffer' })
    const sheet = wb.Sheets.Cheques
    const jCells = Object.entries(sheet)
      .filter(([k]) => /^J\d+$/.test(k))
      .map(([, v]) => (v as { v: string }).v)
    expect(jCells.filter((v) => v === '0000001').length).toBeGreaterThan(0)
    expect(jCells.filter((v) => v === '0000002').length).toBeGreaterThan(0)
    expect(jCells.filter((v) => v === '0000003').length).toBeGreaterThan(0)
  })

  test('lista vacía produce un xlsx mínimo válido', () => {
    const buf = generateCheckXlsx([])
    expect(buf.byteLength).toBeGreaterThan(0)
    const wb = XLSX.read(buf, { type: 'buffer' })
    expect(wb.SheetNames).toContain('Cheques')
  })
})
