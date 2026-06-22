/**
 * Helpers compartidos por los generadores de archivos de banco / contraloría.
 *
 * Replican el comportamiento exacto de los `str_pad`, `number_format` y
 * `eliminar_acentos` del sistema PHP original, porque los bancos y el SIAFPA
 * validan posición por posición — un carácter de más y rechazan el lote.
 */

export type AchAccountType = 'savings' | 'checking'

export type GeneratedFile = {
  content: string
  recordCount: number
  totalAmount: number
}

export const MONTHS_ES = [
  'ENERO',
  'FEBRERO',
  'MARZO',
  'ABRIL',
  'MAYO',
  'JUNIO',
  'JULIO',
  'AGOSTO',
  'SEPTIEMBRE',
  'OCTUBRE',
  'NOVIEMBRE',
  'DICIEMBRE',
]

export function monthNameEs(month: number): string {
  return MONTHS_ES[month - 1] ?? 'MES'
}

/**
 * Equivalente a PHP `str_pad(..., STR_PAD_LEFT)`: NO trunca cuando la cadena
 * ya supera el ancho (igual que PHP). La truncación, donde aplica, se hace
 * explícita con `.slice()` en el punto de uso (replicando los `substr` del PHP).
 */
export function padLeft(value: string | number, width: number, fill = ' '): string {
  const s = String(value)
  if (s.length >= width) return s
  return fill.repeat(width - s.length) + s
}

export function padRight(value: string | number, width: number, fill = ' '): string {
  const s = String(value)
  if (s.length >= width) return s
  return s + fill.repeat(width - s.length)
}

/** Monto a centavos sin punto decimal: 1234.5 → "123450". */
export function toCents(amount: number | string): string {
  return String(toCentsNumber(amount))
}

export function toCentsNumber(amount: number | string): number {
  const n = typeof amount === 'string' ? Number.parseFloat(amount) : amount
  if (!Number.isFinite(n)) return 0
  return Math.round(Math.abs(n) * 100)
}

/** Monto con punto decimal y 2 decimales: 783.4 → "783.40". */
export function toAmount2(amount: number | string): string {
  const n = typeof amount === 'string' ? Number.parseFloat(amount) : amount
  if (!Number.isFinite(n)) return '0.00'
  return Math.abs(n).toFixed(2)
}

const ACCENT_MAP: Record<string, string> = {
  Á: 'A', À: 'A', Â: 'A', Ä: 'A', Ã: 'A', Å: 'A', ª: 'a',
  á: 'a', à: 'a', ä: 'a', â: 'a', ã: 'a', å: 'a',
  É: 'E', È: 'E', Ê: 'E', Ë: 'E', é: 'e', è: 'e', ë: 'e', ê: 'e',
  Í: 'I', Ì: 'I', Ï: 'I', Î: 'I', í: 'i', ì: 'i', ï: 'i', î: 'i',
  Ó: 'O', Ò: 'O', Ö: 'O', Ô: 'O', Õ: 'O', ó: 'o', ò: 'o', ö: 'o', ô: 'o', õ: 'o',
  Ú: 'U', Ù: 'U', Û: 'U', Ü: 'U', ú: 'u', ù: 'u', ü: 'u', û: 'u',
  Ñ: 'N', ñ: 'n', Ç: 'C', ç: 'c',
}

// Caracteres que el PHP elimina por completo de las cadenas ACH.
const STRIP_CHARS = new Set([
  '\\', '¨', 'º', '~', '#', '@', '|', '!', '"', '·', '$', '%', '&', '/',
  '(', ')', '?', "'", '¡', '¿', '[', '^', '<', '>', ']', '+', '}', '{',
  '´', ';', ',', ':', '.',
])

/**
 * Replica `eliminar_acentos()` del PHP: traduce acentos a ASCII, elimina
 * caracteres especiales y reemplaza el guion por dos espacios. Usado en el
 * formato Cabecera/Detalle/Totales (ASCII puro). El formato de líneas `L`
 * (Banco Nacional banca en línea) NO lo usa — preserva Latin-1.
 */
export function eliminarAcentos(input: string): string {
  let out = ''
  for (const ch of input) {
    if (ch in ACCENT_MAP) {
      out += ACCENT_MAP[ch]
      continue
    }
    if (STRIP_CHARS.has(ch)) continue
    out += ch
  }
  // El guion (y la barra invertida, ya eliminada arriba) se vuelven dos espacios.
  return out.replace(/-/g, '  ')
}
