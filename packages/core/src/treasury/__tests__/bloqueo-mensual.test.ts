import { describe, expect, test } from 'bun:test'
import { generateBloqueoMensualText } from '../bloqueo-mensual'

describe('generateBloqueoMensualText', () => {
  test('reproduce byte a byte la línea real (partida base)', () => {
    const r = generateBloqueoMensualText([{ partida: '139010710101001', amount: 387692.5 }], {
      month: 6,
      year: 2025,
    })
    const line = r.content.replace(/\n$/, '')
    expect(line).toBe('139010710101001 000003876925025062025060')
    expect(line.length).toBe(40)
  })

  test('cada fila mide exactamente 40 caracteres', () => {
    const r = generateBloqueoMensualText(
      [
        { partida: '139010710101612', amount: 19600 },
        { partida: '139011210101172', amount: 300 },
      ],
      { month: 6, year: 2025 }
    )
    for (const line of r.content.split('\n').filter(Boolean)) {
      expect(line.length).toBe(40)
    }
  })

  test('día de documento configurable (defecto 25)', () => {
    const r = generateBloqueoMensualText([{ partida: '139010710101001', amount: 100 }], {
      month: 1,
      year: 2022,
    })
    const line = r.content.replace(/\n$/, '')
    // partida(15) + ' ' + monto(13: 100.00→0000000010000) + fecha(25012022) + periodo(01) + tipo(0)
    expect(line).toBe('139010710101001 000000001000025012022010')
    expect(line.length).toBe(40)
  })
})
