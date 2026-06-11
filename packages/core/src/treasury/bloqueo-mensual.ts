/**
 * Generador del fichero plano de BLOQUEO PRESUPUESTARIO MENSUAL para SAP/ISTMO
 * (transacción /IECI/HF_HR_TR_0001 — Carga de Datos de Procesos).
 *
 * Estructura fija de 40 caracteres por línea (spec Dirección Nacional de
 * Contabilidad):
 *
 *   ┌───15───┐ ┌─────13─────┐┌───8────┐┌2┐0
 *    partida  esp   monto¢    DDMMAAAA  per tipo
 *
 *   • partida (15)  — código SIAFPA, espacios a la izquierda
 *   • espacio (1)   — fijo
 *   • monto (13)    — centavos sin punto, ceros a la izquierda
 *   • fecha (8)     — DDMMAAAA (día fijo 25 en el sistema legado)
 *   • período (2)   — mes contable, ceros a la izquierda
 *   • tipo (1)      — '0' = fichero de bloqueo
 *
 * Archivo en LF.
 */

import { type GeneratedFile, padLeft, toCents, toCentsNumber } from './format-helpers'

export type BloqueoMensualEntry = {
  /** Código de partida SIAFPA (15 dígitos, sin puntos). */
  partida: string
  /** Monto a contabilizar (se convierte a centavos). */
  amount: number | string
}

export type BloqueoMensualOptions = {
  /** Mes (1..12). */
  month: number
  /** Año (4 dígitos). */
  year: number
  /** Día del documento (DD). Por defecto 25, como el sistema legado. */
  documentDay?: number
  eol?: string
}

export function generateBloqueoMensualText(
  entries: BloqueoMensualEntry[],
  options: BloqueoMensualOptions
): GeneratedFile {
  const eol = options.eol ?? '\n'
  const mm = padLeft(options.month, 2, '0')
  const dd = padLeft(options.documentDay ?? 25, 2, '0')
  const fecha = `${dd}${mm}${options.year}`

  const lines: string[] = []
  let totalCents = 0

  for (const e of entries) {
    const partida = padLeft(e.partida, 15, ' ')
    const monto = padLeft(toCents(e.amount), 13, '0')
    lines.push(`${partida} ${monto}${fecha}${mm}0`)
    totalCents += toCentsNumber(e.amount)
  }

  const content = lines.length > 0 ? `${lines.join(eol)}${eol}` : ''
  return { content, recordCount: entries.length, totalAmount: totalCents / 100 }
}
