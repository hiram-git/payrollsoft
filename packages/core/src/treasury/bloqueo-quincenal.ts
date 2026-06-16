/**
 * Generador del reporte BLOQUEO PRESUPUESTARIO QUINCENAL
 * ("TOTALES DE CONTROL POR MINISTERIO Y PARTIDA DE LO PAGADO"),
 * un reporte de ancho fijo que recibe la Dirección Nacional de Contabilidad.
 *
 * Agrupa lo pagado (suma del sueldo devengado) por partida presupuestaria y
 * lo lista con sus totales por ministerio. El archivo va en LF y arranca con
 * dos líneas en blanco (como el sistema legado).
 *
 * Layout de cada fila de partida:  año(13) + partida(17) + valor(25),
 * todos justificados a la derecha.
 */

import { type GeneratedFile, monthNameEs, padLeft, toAmount2, toCentsNumber } from './format-helpers'

export type BloqueoQuincenalPartida = {
  /** Código de partida presupuestaria. */
  partida: string
  /** Total pagado a cargo de la partida. */
  total: number | string
}

export type BloqueoQuincenalOptions = {
  /** Nombre de la entidad/ministerio (encabezado y línea de ministerio). */
  entityName: string
  /** Código de ministerio (p. ej. "139"). */
  ministerioCode: string
  /** Fecha que se imprime en la línea "Fecha:" (p. ej. "2025-06-26"). */
  paymentDateLabel: string
  /** Mes 1..12 (para el nombre del mes en el encabezado). */
  month: number
  /** Año (4 dígitos). */
  year: number
  /** Quincena: 1 = PRIMERA_QUINCENA, 2 = SEGUNDA_QUINCENA. */
  half: 1 | 2
  /**
   * Etiqueta de período que reemplaza a PRIMERA/SEGUNDA_QUINCENA en el
   * encabezado. Se usa para el bloqueo agregado por mes (p. ej. "MENSUAL").
   */
  periodLabel?: string
  /** Sufijo de partida para frecuencias especiales (XIII mes → "050", GR → "030"). */
  partidaSuffix?: '050' | '030' | null
  eol?: string
}

function transformPartida(partida: string, suffix?: '050' | '030' | null): string {
  const p = suffix ? partida.slice(0, 18) + suffix : partida
  return p.replace(/\./g, '')
}

export function generateBloqueoQuincenalText(
  partidas: BloqueoQuincenalPartida[],
  options: BloqueoQuincenalOptions
): GeneratedFile {
  const eol = options.eol ?? '\n'
  const quincenaLabel =
    options.periodLabel ?? (options.half === 1 ? 'PRIMERA_QUINCENA' : 'SEGUNDA_QUINCENA')

  const out: string[] = ['', '']
  out.push(`Fecha: ${options.paymentDateLabel}${' '.repeat(40)}PAGINA: 1     de 1`)
  out.push('')
  out.push(`${' '.repeat(20)}${options.entityName}`)
  out.push(`${' '.repeat(22)}DIRECCION NACIONAL DE CONTABILIDAD`)
  out.push(`${' '.repeat(11)}TOTALES DE CONTROL POR MINISTERIO Y PARTIDA DE LO PAGADO`)
  out.push(`${' '.repeat(13)}EN ${monthNameEs(options.month)} ${quincenaLabel} ${options.year}`)
  out.push('')
  out.push(`${' '.repeat(9)}MINISTERIO:   ${options.ministerioCode}  ${options.entityName}`)
  out.push('')
  out.push(`${' '.repeat(18)}PARTIDA${' '.repeat(17)}VALOR`)
  out.push('')

  let totalCents = 0
  for (const p of partidas) {
    const code = transformPartida(p.partida, options.partidaSuffix)
    out.push(`${padLeft(options.year, 13)}${padLeft(code, 17)}${padLeft(toAmount2(p.total), 25)}`)
    out.push('')
    totalCents += toCentsNumber(p.total)
  }

  const totalStr = (totalCents / 100).toFixed(2)
  out.push(`${' '.repeat(40)}${'-'.repeat(15)}`)
  out.push(`${' '.repeat(13)}TOTAL MINISTERIO${padLeft(totalStr, 26)}`)
  out.push(`${' '.repeat(40)}${'-'.repeat(15)}`)
  out.push(`${' '.repeat(13)}TOTAL FINAL${padLeft(totalStr, 31)}`)

  return {
    content: `${out.join(eol)}${eol}`,
    recordCount: partidas.length,
    totalAmount: totalCents / 100,
  }
}
