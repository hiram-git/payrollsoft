import { describe, expect, test } from 'bun:test'
import { generateBloqueoQuincenalText } from '../bloqueo-quincenal'

const PARTIDAS = [
  { partida: '139010710101001', total: 167390.42 },
  { partida: '139010710101002', total: 4175.0 },
  { partida: '139020710101001', total: 184963.25 },
  { partida: '139020710101002', total: 17862.5 },
  { partida: '139115010101004', total: 56094.92 },
]

const OPTS = {
  entityName: 'INSTITUTO TECNICO SUPERIOR ESPECIALIZADO',
  ministerioCode: '139',
  paymentDateLabel: '2025-06-26',
  month: 6,
  year: 2025,
  half: 2 as const,
}

describe('generateBloqueoQuincenalText', () => {
  test('reproduce la estructura y los totales de la muestra real', () => {
    const r = generateBloqueoQuincenalText(PARTIDAS, OPTS)
    const lines = r.content.split('\n')

    expect(lines[0]).toBe('')
    expect(lines[1]).toBe('')
    expect(lines[2]).toBe(`Fecha: 2025-06-26${' '.repeat(40)}PAGINA: 1     de 1`)
    expect(lines[4]).toBe(`${' '.repeat(20)}INSTITUTO TECNICO SUPERIOR ESPECIALIZADO`)
    expect(lines[5]).toBe(`${' '.repeat(22)}DIRECCION NACIONAL DE CONTABILIDAD`)
    expect(lines[6]).toBe(`${' '.repeat(11)}TOTALES DE CONTROL POR MINISTERIO Y PARTIDA DE LO PAGADO`)
    expect(lines[7]).toBe(`${' '.repeat(13)}EN JUNIO SEGUNDA_QUINCENA 2025`)
    expect(lines[9]).toBe(`${' '.repeat(9)}MINISTERIO:   139  INSTITUTO TECNICO SUPERIOR ESPECIALIZADO`)
    expect(lines[11]).toBe(`${' '.repeat(18)}PARTIDA${' '.repeat(17)}VALOR`)

    // Primera fila de partida
    expect(lines[13]).toBe('         2025  139010710101001                167390.42')
    expect(lines[13].length).toBe(55)

    // Totales
    expect(lines[23]).toBe(`${' '.repeat(40)}${'-'.repeat(15)}`)
    expect(lines[24]).toBe('             TOTAL MINISTERIO                 430486.09')
    expect(lines[26]).toBe('             TOTAL FINAL                      430486.09')

    expect(r.totalAmount).toBe(430486.09)
  })

  test('PRIMERA_QUINCENA cuando half=1', () => {
    const r = generateBloqueoQuincenalText(PARTIDAS, { ...OPTS, half: 1 })
    expect(r.content).toContain('EN JUNIO PRIMERA_QUINCENA 2025')
  })
})
