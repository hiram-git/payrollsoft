/**
 * Generador del archivo ACH de líneas `L` (banca en línea — pago por cuenta
 * de Banco Nacional de Panamá; en el sistema legado: `banconacionalpanama.txt`).
 *
 * Cada empleado produce UN registro:
 *
 *   L┌─15─┐┌──22──┐┌─11─┐┌─9─┐┌──17──┐DD REF\r\nAPAGO DE PLANILLA {descrip}
 *   L cedula nombre  monto  ruta  cuenta
 *
 *   • cedula  — 15, ceros a la izquierda
 *   • nombre  — 22, espacios a la derecha (truncado si más largo)
 *   • monto   — 11, ceros a la izquierda, CON punto decimal ("00000783.46")
 *   • ruta    — 9, ceros a la izquierda (ruta del banco destino)
 *   • cuenta  — 17, espacios a la derecha
 *
 * El texto `\r\n` entre `REF` y `APAGO` es LITERAL (4 caracteres: barra-r-barra-n),
 * tal como lo emite el PHP original (cadena con comillas simples). El registro
 * termina con un CRLF real. El archivo va codificado en Latin-1 (ISO-8859-1),
 * por eso la `Ñ` se preserva como byte 0xD1.
 */

import { type GeneratedFile, padLeft, padRight, toAmount2, toCentsNumber } from './format-helpers'

export type BancoNacionalEntry = {
  /** Cédula formateada por el caller (p. ej. "1-45-699"). */
  identification: string
  /** Nombre del beneficiario tal como debe imprimirse (no se sanitiza). */
  beneficiaryName: string
  /** Neto a depositar. */
  amount: number | string
  /** Ruta del banco destino. */
  routing: string
  /** Número de cuenta del beneficiario. */
  accountNumber: string
}

export type BancoNacionalOptions = {
  /** Descripción de la planilla (va tras "APAGO DE PLANILLA "). */
  description: string
  /** Terminador de registro. Por defecto CRLF (lo que espera el banco). */
  eol?: string
}

const LITERAL_REF = 'DD REF\\r\\n'

export function generateBancoNacionalText(
  entries: BancoNacionalEntry[],
  options: BancoNacionalOptions
): GeneratedFile {
  const eol = options.eol ?? '\r\n'
  const lines: string[] = []
  let totalCents = 0

  for (const e of entries) {
    const cedula = padLeft(e.identification, 15, '0')
    const name = e.beneficiaryName.length > 22 ? e.beneficiaryName.slice(0, 22) : padRight(e.beneficiaryName, 22, ' ')
    const amount = padLeft(toAmount2(e.amount), 11, '0')
    const routing = padLeft(e.routing, 9, '0')
    const account = padRight(e.accountNumber, 17, ' ')

    lines.push(`L${cedula}${name}${amount}${routing}${account}${LITERAL_REF}APAGO DE PLANILLA ${options.description}`)
    totalCents += toCentsNumber(e.amount)
  }

  const content = lines.length > 0 ? `${lines.join(eol)}${eol}` : ''
  return { content, recordCount: entries.length, totalAmount: totalCents / 100 }
}
