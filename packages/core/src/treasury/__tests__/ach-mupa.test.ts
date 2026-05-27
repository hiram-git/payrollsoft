import { describe, expect, test } from 'bun:test'
import { generateAchMupaText } from '../ach-mupa'

describe('generateAchMupaText', () => {
  const period = { frequency: 'first' as const, month: 1, year: 2026 }

  test('archivo vacío con cero entries', () => {
    const r = generateAchMupaText([], period)
    expect(r.content).toBe('')
    expect(r.recordCount).toBe(0)
    expect(r.totalAmount).toBe(0)
  })

  test('una entrada produce dos líneas L+A de 100 chars cada una', () => {
    const r = generateAchMupaText(
      [
        {
          identification: '8-123-456',
          beneficiaryName: 'PEREZ JUAN',
          amount: 500.75,
          paymentDate: '2026-01-15',
          routing: '0006',
          accountNumber: '0123456789',
          accountType: 'savings',
        },
      ],
      period
    )
    const lines = r.content.replace(/\r\n$/, '').split('\r\n')
    expect(lines).toHaveLength(2)
    expect(lines[0].length).toBe(100)
    expect(lines[1].length).toBe(100)
    expect(lines[0].startsWith('L')).toBe(true)
    expect(lines[1].startsWith('A')).toBe(true)
    expect(lines[1].includes('PRIMERA QUINCENA DE ENERO DE 2026')).toBe(true)
  })

  test('cédula se pad-leftea con ceros hasta 15', () => {
    const r = generateAchMupaText(
      [
        {
          identification: '8123456',
          beneficiaryName: 'X',
          amount: 1,
          paymentDate: '20260115',
          routing: '1',
          accountNumber: '1',
          accountType: 'checking',
        },
      ],
      period
    )
    const detail = r.content.split('\r\n')[0]
    // L + 15 char cedula
    expect(detail.slice(1, 16)).toBe('000000008123456')
  })

  test('monto sin punto decimal, 11 chars, ceros a la izquierda', () => {
    const r = generateAchMupaText(
      [
        {
          identification: '8-123-456',
          beneficiaryName: 'X',
          amount: 1234.5,
          paymentDate: '20260115',
          routing: '1',
          accountNumber: '1',
          accountType: 'savings',
        },
      ],
      period
    )
    const detail = r.content.split('\r\n')[0]
    // posición: L(1) + cedula(15) + nombre(22) = 38, monto 38..49
    expect(detail.slice(38, 49)).toBe('00000123450')
  })

  test('savings → SC, checking → DC', () => {
    const r = generateAchMupaText(
      [
        {
          identification: '1',
          beneficiaryName: 'X',
          amount: 1,
          paymentDate: '20260115',
          routing: '1',
          accountNumber: '1',
          accountType: 'savings',
        },
        {
          identification: '2',
          beneficiaryName: 'Y',
          amount: 1,
          paymentDate: '20260115',
          routing: '1',
          accountNumber: '1',
          accountType: 'checking',
        },
      ],
      period
    )
    const lines = r.content.replace(/\r\n$/, '').split('\r\n')
    // Tipo de cuenta vive en chars 83..99 (16 chars padded).
    // Offsets: L(1) + cedula(15) + nombre(22) + monto(11) + fecha(8)
    //   + routing(9) + account(17) = 83, luego type(16) = 99.
    expect(lines[0].slice(83, 85)).toBe('SC')
    expect(lines[2].slice(83, 85)).toBe('DC')
  })

  test('totales acumulados correctamente', () => {
    const r = generateAchMupaText(
      [
        {
          identification: '1',
          beneficiaryName: 'X',
          amount: 100.5,
          paymentDate: '20260115',
          routing: '1',
          accountNumber: '1',
          accountType: 'savings',
        },
        {
          identification: '2',
          beneficiaryName: 'Y',
          amount: 200.25,
          paymentDate: '20260115',
          routing: '1',
          accountNumber: '1',
          accountType: 'savings',
        },
      ],
      period
    )
    expect(r.recordCount).toBe(2)
    expect(r.totalAmount).toBe(300.75)
  })

  test('nombre se trunca a 22 caracteres', () => {
    const r = generateAchMupaText(
      [
        {
          identification: '1',
          beneficiaryName: 'ALGUIEN CON UN NOMBRE EXTREMADAMENTE LARGO',
          amount: 1,
          paymentDate: '20260115',
          routing: '1',
          accountNumber: '1',
          accountType: 'savings',
        },
      ],
      period
    )
    const detail = r.content.split('\r\n')[0]
    const namePart = detail.slice(16, 38)
    expect(namePart).toBe('ALGUIEN CON UN NOMBRE ')
    expect(namePart.length).toBe(22)
  })

  test('quita acentos antes de escribir', () => {
    const r = generateAchMupaText(
      [
        {
          identification: '1',
          beneficiaryName: 'PEÑA MARÍA',
          amount: 1,
          paymentDate: '20260115',
          routing: '1',
          accountNumber: '1',
          accountType: 'savings',
        },
      ],
      period
    )
    const namePart = r.content.split('\r\n')[0].slice(16, 38)
    expect(namePart.trim()).toBe('PENA MARIA')
  })

  test('frecuencia "second" produce "SEGUNDA QUINCENA"', () => {
    const r = generateAchMupaText(
      [
        {
          identification: '1',
          beneficiaryName: 'X',
          amount: 1,
          paymentDate: '20260115',
          routing: '1',
          accountNumber: '1',
          accountType: 'savings',
        },
      ],
      { frequency: 'second', month: 3, year: 2026 }
    )
    expect(r.content).toContain('SEGUNDA QUINCENA DE MARZO DE 2026')
  })
})
