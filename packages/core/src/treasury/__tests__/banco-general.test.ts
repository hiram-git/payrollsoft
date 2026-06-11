import { describe, expect, test } from 'bun:test'
import { type BancoGeneralEntry, generateBancoGeneralText } from '../banco-general'

const DESC = 'REGULAR-2da Quincena - DEL 16/06/2025 - Al 30/06/2025'

describe('generateBancoGeneralText', () => {
  test('detalle ACH (DA) byte a byte — EVELIA PRESCOTT', () => {
    const e: BancoGeneralEntry = {
      beneficiaryName: 'EVELIA PRESCOTT',
      amount: 963.45,
      accountNumber: '403019747520',
      accountType: 'savings',
      bankCode: '71',
      onUs: false,
      description: DESC,
    }
    const r = generateBancoGeneralText([e])
    const detail = r.content.split('\n')[1]
    expect(detail).toBe(
      'DA403019747520     EVELIA PRESCOTT               S000000071000000096345REGULAR  2da Quincena            '
    )
    expect(detail.length).toBe(104)
  })

  test('detalle on-us (DC) byte a byte — CARLOS GARDEL', () => {
    const e: BancoGeneralEntry = {
      beneficiaryName: 'CARLOS GARDEL',
      amount: 783.46,
      accountNumber: '40013711042',
      accountType: 'savings',
      bankCode: '13',
      onUs: true,
      description: DESC,
    }
    const r = generateBancoGeneralText([e])
    const detail = r.content.split('\n')[1]
    expect(detail).toBe(
      'DC40013711042      CARLOS GARDEL                 S000000013000000078346REGULAR  2da Quincena            '
    )
  })

  test('cabecera y totales: C/T + conteo(9) + monto¢(12), sin salto final', () => {
    const mk = (amount: number, onUs = false): BancoGeneralEntry => ({
      beneficiaryName: 'X',
      amount,
      accountNumber: '1',
      accountType: 'checking',
      bankCode: '71',
      onUs,
      description: DESC,
    })
    const r = generateBancoGeneralText([mk(963.45), mk(783.46)])
    const lines = r.content.split('\n')
    // total = 96345 + 78346 = 174691 centavos
    expect(lines[0]).toBe('C000000002000000174691')
    expect(lines.at(-1)).toBe('T000000002000000174691')
    expect(r.content.endsWith('\n')).toBe(false)
    expect(r.totalAmount).toBe(1746.91)
  })

  test('corriente → C en tipo de cuenta', () => {
    const r = generateBancoGeneralText([
      {
        beneficiaryName: 'REBECA BIEBERACH',
        amount: 1495.77,
        accountNumber: '303010246665',
        accountType: 'checking',
        bankCode: '71',
        onUs: false,
        description: DESC,
      },
    ])
    const detail = r.content.split('\n')[1]
    // tipo de cuenta en pos 50 (índice 49)
    expect(detail[49]).toBe('C')
  })
})
