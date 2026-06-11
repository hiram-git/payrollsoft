import { describe, expect, test } from 'bun:test'
import { generateBancoNacionalText } from '../banco-nacional'

const DESC = 'REGULAR-2da Quincena - DEL 16/06/2025 - Al 30/06/2025'

describe('generateBancoNacionalText', () => {
  test('reproduce byte a byte la línea real de la muestra (CARLOS GARDEL)', () => {
    const r = generateBancoNacionalText(
      [
        {
          identification: '1-45-699',
          beneficiaryName: 'CARLOS GARDEL FERNANDEZ',
          amount: 783.46,
          routing: '13',
          accountNumber: '40013711042',
        },
      ],
      { description: DESC }
    )
    const expected =
      'L00000001-45-699CARLOS GARDEL FERNANDE00000783.4600000001340013711042      DD REF\\r\\nAPAGO DE PLANILLA REGULAR-2da Quincena - DEL 16/06/2025 - Al 30/06/2025'
    expect(r.content).toBe(`${expected}\r\n`)
    expect(r.recordCount).toBe(1)
    expect(r.totalAmount).toBe(783.46)
  })

  test('preserva la Ñ (Latin-1) y trunca el nombre a 22', () => {
    const r = generateBancoNacionalText(
      [
        {
          identification: '2-156-327',
          beneficiaryName: 'MARTIN ALBERTO MUÑOZ PEREZ',
          amount: 711.46,
          routing: '13',
          accountNumber: '40022119000',
        },
      ],
      { description: DESC }
    )
    const record = r.content.replace(/\r\n$/, '')
    // L(1) + cedula(15) → nombre en 16..38
    expect(record.slice(16, 38)).toBe('MARTIN ALBERTO MUÑOZ P')
    expect(record.slice(16, 38).length).toBe(22)
  })

  test('monto con punto decimal, 11 chars, ceros a la izquierda', () => {
    const r = generateBancoNacionalText(
      [{ identification: '8-1-1', beneficiaryName: 'X', amount: 348, routing: '13', accountNumber: '1' }],
      { description: DESC }
    )
    const record = r.content.replace(/\r\n$/, '')
    // L(1)+cedula(15)+nombre(22) = 38, monto 38..49
    expect(record.slice(38, 49)).toBe('00000348.00')
  })

  test('archivo vacío', () => {
    const r = generateBancoNacionalText([], { description: DESC })
    expect(r.content).toBe('')
    expect(r.recordCount).toBe(0)
  })
})
