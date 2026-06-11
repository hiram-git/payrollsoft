/**
 * Generador del archivo ACH formato Cabecera/Detalle/Totales (estructura
 * "pago de planilla y proveedores por banca en línea"; en el sistema legado
 * se exportaba como `ACH REGULAR ...txt`).
 *
 *   Cabecera:  C ┌──9──┐┌───12───┐            C + #registros + monto¢
 *   Detalle:   D X ┌─17─┐┌──30──┐ X ┌─9─┐┌──12──┐┌──33──┐
 *   Totales:   T ┌──9──┐┌───12───┐            T + #registros + monto¢
 *
 * Detalle (104 posiciones — el campo de identificación 105-129 del spec es
 * opcional y el sistema legado lo omite):
 *   • banco (1)       — 'C' si la cuenta es de la entidad originadora (BNP),
 *                       'A' si va por ACH interbancario
 *   • cuenta (17)     — espacios a la derecha
 *   • nombre (30)     — ASCII sin acentos, mayúsculas, espacios a la derecha
 *   • tipo cuenta (1) — 'S'=ahorro, 'C'=corriente
 *   • código banco (9)— ceros a la izquierda (entidad destino)
 *   • monto (12)      — centavos sin punto, ceros a la izquierda
 *   • descripción (33)— primeros 24 chars sanitizados, espacios a la derecha
 *
 * El archivo usa LF y NO lleva salto de línea tras la línea de Totales.
 */

import { eliminarAcentos, type GeneratedFile, padLeft, padRight, toCents, toCentsNumber } from './format-helpers'

export type BancoGeneralEntry = {
  /** "Nombres Apellidos" — se pasa a mayúsculas y se sanitiza a ASCII. */
  beneficiaryName: string
  amount: number | string
  accountNumber: string
  accountType: 'savings' | 'checking'
  /** Código de entidad del banco destino (9 dígitos tras el padding). */
  bankCode: string
  /** true cuando la cuenta destino es de la entidad originadora (→ 'C'/BNP). */
  onUs: boolean
  /** Descripción de la planilla; se toman los primeros 24 chars sanitizados. */
  description: string
}

export type BancoGeneralOptions = {
  /** Terminador de línea. Por defecto LF (lo que emite el sistema legado). */
  eol?: string
}

function detailLine(e: BancoGeneralEntry): string {
  const banco = e.onUs ? 'C' : 'A'
  const account = padRight(e.accountNumber, 17, ' ')
  const name = padRight(eliminarAcentos(e.beneficiaryName.toUpperCase()).slice(0, 30), 30, ' ')
  const accType = e.accountType === 'savings' ? 'S' : 'C'
  const bankCode = padLeft(e.bankCode, 9, '0')
  const amount = padLeft(toCents(e.amount), 12, '0')
  const description = padRight(eliminarAcentos(e.description).slice(0, 24), 33, ' ')
  return `D${banco}${account}${name}${accType}${bankCode}${amount}${description}`
}

export function generateBancoGeneralText(
  entries: BancoGeneralEntry[],
  options: BancoGeneralOptions = {}
): GeneratedFile {
  const eol = options.eol ?? '\n'
  const count = padLeft(entries.length, 9, '0')
  const totalCents = entries.reduce((acc, e) => acc + toCentsNumber(e.amount), 0)
  const total = padLeft(totalCents, 12, '0')

  const header = `C${count}${total}`
  const trailer = `T${count}${total}`
  const body = entries.map((e) => detailLine(e) + eol).join('')

  const content = `${header}${eol}${body}${trailer}`
  return { content, recordCount: entries.length, totalAmount: totalCents / 100 }
}
