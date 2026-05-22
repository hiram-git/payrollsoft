/**
 * Convierte un monto numérico a su representación en palabras en
 * español, en mayúsculas, para imprimir en cheques.
 *
 * Equivalente al `EnLetras::ValorEnLetras($monto, "balboas")` del
 * código PHP original. Soporta números hasta el orden de los
 * millones — suficiente para sueldos y pagos a acreedores.
 *
 *   amountToWords(1234.50, 'balboas')
 *     → "MIL DOSCIENTOS TREINTA Y CUATRO BALBOAS CON 50/100"
 *
 *   amountToWords(1, 'balboa')   // singular para 1
 *     → "UN BALBOA CON 00/100"
 *
 *   amountToWords(0.75)
 *     → "CERO BALBOAS CON 75/100"
 *
 * Decisiones de diseño:
 *   • Los centavos se imprimen en formato N/100 (lo que pide el banco).
 *   • La moneda llega como string; el caller decide singular/plural.
 *     El default es "balboas" porque PayrollSoft es Panamá-first.
 *   • Mayúsculas siempre (formato de cheque legal).
 */

const UNITS = ['', 'UN', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE']

const TEN_TO_NINETEEN = [
  'DIEZ',
  'ONCE',
  'DOCE',
  'TRECE',
  'CATORCE',
  'QUINCE',
  'DIECISÉIS',
  'DIECISIETE',
  'DIECIOCHO',
  'DIECINUEVE',
]

const TENS = [
  '',
  '',
  'VEINTE',
  'TREINTA',
  'CUARENTA',
  'CINCUENTA',
  'SESENTA',
  'SETENTA',
  'OCHENTA',
  'NOVENTA',
]

const HUNDREDS = [
  '',
  'CIENTO',
  'DOSCIENTOS',
  'TRESCIENTOS',
  'CUATROCIENTOS',
  'QUINIENTOS',
  'SEISCIENTOS',
  'SETECIENTOS',
  'OCHOCIENTOS',
  'NOVECIENTOS',
]

/** Convierte 1..999 a palabras. */
function hundredsToWords(n: number): string {
  if (n === 0) return ''
  if (n === 100) return 'CIEN'
  const h = Math.floor(n / 100)
  const rest = n % 100
  const tens = Math.floor(rest / 10)
  const units = rest % 10

  const parts: string[] = []
  if (h > 0) parts.push(HUNDREDS[h])
  if (rest === 0) return parts.join(' ')

  if (tens === 0) {
    parts.push(UNITS[units])
  } else if (tens === 1) {
    parts.push(TEN_TO_NINETEEN[units])
  } else if (tens === 2 && units > 0) {
    // 21..29: "VEINTIUNO", "VEINTIDÓS"... (forma contraída común)
    parts.push(`VEINTI${UNITS[units]}`.replace(/^VEINTIUN$/, 'VEINTIUNO'))
  } else if (units === 0) {
    parts.push(TENS[tens])
  } else {
    parts.push(`${TENS[tens]} Y ${UNITS[units]}`)
  }
  return parts.join(' ')
}

/** Convierte el entero completo a palabras. */
function integerToWords(n: number): string {
  if (n === 0) return 'CERO'
  if (n < 0) return `MENOS ${integerToWords(-n)}`

  const millions = Math.floor(n / 1_000_000)
  const thousands = Math.floor((n % 1_000_000) / 1_000)
  const remainder = n % 1_000

  const parts: string[] = []

  if (millions > 0) {
    if (millions === 1) parts.push('UN MILLÓN')
    else parts.push(`${hundredsToWords(millions)} MILLONES`)
  }

  if (thousands > 0) {
    if (thousands === 1) parts.push('MIL')
    else parts.push(`${hundredsToWords(thousands)} MIL`)
  }

  if (remainder > 0) {
    parts.push(hundredsToWords(remainder))
  }

  return parts.join(' ').replace(/\s+/g, ' ').trim()
}

/**
 * Convierte un monto a palabras en formato cheque.
 *
 * @param amount Monto numérico (acepta number o string parseable).
 * @param currency Etiqueta de moneda en plural. Default: 'balboas'.
 * @param singular Etiqueta singular (para amount=1). Default: deriva
 *                 quitando la 's' final de `currency`.
 */
export function amountToWords(
  amount: number | string,
  currency = 'balboas',
  singular?: string
): string {
  const num = typeof amount === 'string' ? Number.parseFloat(amount) : amount
  if (!Number.isFinite(num)) return ''
  // Trunco a 2 decimales con redondeo bancario simple.
  const fixed = Math.round(Math.abs(num) * 100) / 100
  const intPart = Math.floor(fixed)
  const cents = Math.round((fixed - intPart) * 100)

  const intWords = integerToWords(intPart)
  const singularLabel = singular ?? (currency.endsWith('s') ? currency.slice(0, -1) : currency)
  const currencyLabel = intPart === 1 ? singularLabel : currency

  const centsPart = `${String(cents).padStart(2, '0')}/100`
  return `${intWords} ${currencyLabel.toUpperCase()} CON ${centsPart}`
}
