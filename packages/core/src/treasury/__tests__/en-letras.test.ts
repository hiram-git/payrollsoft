import { describe, expect, test } from 'bun:test'
import { amountToWords } from '../en-letras'

describe('amountToWords', () => {
  test('cero balboas con 00/100', () => {
    expect(amountToWords(0)).toBe('CERO BALBOAS CON 00/100')
  })

  test('un balboa (singular) con 00/100', () => {
    expect(amountToWords(1)).toBe('UN BALBOA CON 00/100')
  })

  test('un balboa con centavos preserva singular', () => {
    expect(amountToWords(1.5)).toBe('UN BALBOA CON 50/100')
  })

  test('dos balboas con 75/100', () => {
    expect(amountToWords(2.75)).toBe('DOS BALBOAS CON 75/100')
  })

  test('once veinticinco', () => {
    expect(amountToWords(11.25)).toBe('ONCE BALBOAS CON 25/100')
  })

  test('decenas con conjunción "y"', () => {
    expect(amountToWords(34)).toBe('TREINTA Y CUATRO BALBOAS CON 00/100')
    expect(amountToWords(99)).toBe('NOVENTA Y NUEVE BALBOAS CON 00/100')
  })

  test('veintiuno se contrae', () => {
    expect(amountToWords(21)).toBe('VEINTIUNO BALBOAS CON 00/100')
    expect(amountToWords(28)).toBe('VEINTIOCHO BALBOAS CON 00/100')
  })

  test('cien exacto', () => {
    expect(amountToWords(100)).toBe('CIEN BALBOAS CON 00/100')
  })

  test('ciento uno (no cien uno)', () => {
    expect(amountToWords(101)).toBe('CIENTO UN BALBOAS CON 00/100')
  })

  test('cientos', () => {
    expect(amountToWords(500)).toBe('QUINIENTOS BALBOAS CON 00/100')
    expect(amountToWords(750)).toBe('SETECIENTOS CINCUENTA BALBOAS CON 00/100')
  })

  test('mil exacto', () => {
    expect(amountToWords(1000)).toBe('MIL BALBOAS CON 00/100')
  })

  test('mil doscientos treinta y cuatro con 50/100', () => {
    expect(amountToWords(1234.5)).toBe('MIL DOSCIENTOS TREINTA Y CUATRO BALBOAS CON 50/100')
  })

  test('cinco mil', () => {
    expect(amountToWords(5000)).toBe('CINCO MIL BALBOAS CON 00/100')
  })

  test('un millón exacto', () => {
    expect(amountToWords(1_000_000)).toBe('UN MILLÓN BALBOAS CON 00/100')
  })

  test('dos millones quinientos mil', () => {
    expect(amountToWords(2_500_000)).toBe('DOS MILLONES QUINIENTOS MIL BALBOAS CON 00/100')
  })

  test('redondea correctamente 0.005 → 0.01', () => {
    expect(amountToWords(0.005)).toBe('CERO BALBOAS CON 01/100')
  })

  test('acepta string numérico', () => {
    expect(amountToWords('150.25')).toBe('CIENTO CINCUENTA BALBOAS CON 25/100')
  })

  test('moneda custom — dólares', () => {
    expect(amountToWords(12.34, 'dólares')).toBe('DOCE DÓLARES CON 34/100')
  })

  test('singular custom', () => {
    expect(amountToWords(1, 'dólares', 'dólar')).toBe('UN DÓLAR CON 00/100')
  })

  test('input inválido devuelve cadena vacía', () => {
    expect(amountToWords(Number.NaN)).toBe('')
    expect(amountToWords('abc')).toBe('')
  })
})
