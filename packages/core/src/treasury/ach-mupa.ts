/**
 * Generador de TXT ACH formato MUPA v1.
 *
 * Replica el formato de ancho fijo que se usaba en el sistema PHP
 * original — el que el municipio/empresas envía al banco para que
 * deposite los netos a las cuentas de los empleados.
 *
 * Estructura: cada empleado produce DOS líneas consecutivas:
 *
 *   1. Línea L (detalle de transferencia):
 *        L  ┌─15─┐┌──22──┐┌─11─┐┌─8─┐┌─9─┐┌─17─┐┌─16─┐
 *        L  cedula  nombre  monto fecha ruta  cuenta tipo
 *        Total: 1 + 15 + 22 + 11 + 8 + 9 + 17 + 16 = 99
 *        Padded a 100 con espacio a la derecha.
 *
 *   2. Línea A (descripción del período):
 *        A "PRIMERA QUINCENA DE ENERO DE 2026"
 *        Padded a 100.
 *
 * Reglas de padding (todas STR_PAD del PHP):
 *   • `cedula` — 15 char, ceros a la izquierda
 *   • `nombre` — 22 char, espacios a la derecha (TRUNCADO si más largo)
 *   • `monto`  — 11 char, ceros a la izquierda, sin punto decimal
 *               (1234.50 → "00000123450")
 *   • `fecha`  — YYYYMMDD (8 chars exactos)
 *   • `routing`— 9 char, ceros a la izquierda
 *   • `account`— 17 char, espacios a la derecha
 *   • `type`   — 16 char, espacios a la derecha (códigos: "SC"=savings,
 *               "DC"=checking demand)
 */

export type AchAccountType = 'savings' | 'checking'

/** Una transferencia individual para incluir en el batch. */
export type AchEntry = {
  /** Cédula formateada — el caller decide cómo armarla (sigla + tomo + folio). */
  identification: string
  /** Nombre del beneficiario (Apellido Nombre). */
  beneficiaryName: string
  /** Monto en balboas; 1234.50 se escribe como "00000123450". */
  amount: number | string
  /** Fecha del depósito (YYYY-MM-DD o YYYYMMDD). */
  paymentDate: string
  /** Número de ruta del banco destino. */
  routing: string
  /** Número de cuenta. */
  accountNumber: string
  accountType: AchAccountType
}

/** Bloque de descripción para la línea A. */
export type AchPeriodDescription = {
  /** 'first' (primera quincena) | 'second' (segunda quincena) | 'monthly' (mensual) | string custom */
  frequency: 'first' | 'second' | 'monthly' | string
  /** 1..12 */
  month: number
  /** Año (4 dígitos) */
  year: number
}

const MONTHS_ES = [
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

const ACCOUNT_TYPE_CODE: Record<AchAccountType, string> = {
  savings: 'SC',
  checking: 'DC',
}

/**
 * Elimina acentos y caracteres no-ASCII básicos. Iteramos por
 * codepoint y dejamos pasar solo los ASCII imprimibles (0x20..0x7e),
 * lo que automáticamente filtra los "Combining Diacritical Marks"
 * (U+0300..U+036F) que produce `normalize('NFD')`. Evitamos los
 * character classes de regex con combining marks porque biome los
 * rechaza por considerarlos ambiguos.
 */
function sanitize(str: string): string {
  const normalized = str.normalize('NFD')
  let out = ''
  for (const ch of normalized) {
    if (ch === 'Ñ') {
      out += 'N'
      continue
    }
    if (ch === 'ñ') {
      out += 'n'
      continue
    }
    const cp = ch.codePointAt(0) ?? 0
    if (cp >= 0x20 && cp <= 0x7e) out += ch
  }
  return out
}

function padLeft(s: string, width: number, ch = ' '): string {
  const v = String(s)
  if (v.length >= width) return v.slice(-width)
  return ch.repeat(width - v.length) + v
}

function padRight(s: string, width: number, ch = ' '): string {
  const v = String(s)
  if (v.length >= width) return v.slice(0, width)
  return v + ch.repeat(width - v.length)
}

function formatAmount(amount: number | string): string {
  const n = typeof amount === 'string' ? Number.parseFloat(amount) : amount
  if (!Number.isFinite(n)) return padLeft('0', 11, '0')
  // 1234.50 → "1234.50" → "123450"
  const cents = Math.round(Math.abs(n) * 100).toString()
  return padLeft(cents, 11, '0')
}

function normalizeDate(s: string): string {
  // Acepta YYYY-MM-DD o YYYYMMDD; devuelve YYYYMMDD.
  const compact = s.replace(/-/g, '')
  return compact.slice(0, 8)
}

function describePeriod(p: AchPeriodDescription): string {
  const month = MONTHS_ES[p.month - 1] ?? 'MES'
  const year = String(p.year)
  let label: string
  switch (p.frequency) {
    case 'first':
      label = 'PRIMERA QUINCENA'
      break
    case 'second':
      label = 'SEGUNDA QUINCENA'
      break
    case 'monthly':
      label = 'MES'
      break
    default:
      label = sanitize(String(p.frequency).toUpperCase())
  }
  return `${label} DE ${month} DE ${year}`
}

/** Genera el contenido del archivo TXT ACH. */
export function generateAchMupaText(
  entries: AchEntry[],
  period: AchPeriodDescription
): { content: string; totalAmount: number; recordCount: number } {
  const descLine = padRight(`A${describePeriod(period)}`, 100, ' ')
  const lines: string[] = []
  let totalCents = 0

  for (const e of entries) {
    const cedula = padLeft(sanitize(e.identification), 15, '0')
    const name = padRight(sanitize(e.beneficiaryName), 22, ' ')
    const amount = formatAmount(e.amount)
    const date = normalizeDate(e.paymentDate)
    const routing = padLeft(sanitize(e.routing), 9, '0')
    const account = padRight(sanitize(e.accountNumber), 17, ' ')
    const accType = padRight(ACCOUNT_TYPE_CODE[e.accountType], 16, ' ')

    const detail = padRight(
      `L${cedula}${name}${amount}${date}${routing}${account}${accType}`,
      100,
      ' '
    )
    lines.push(detail)
    lines.push(descLine)

    // Acumular para el total (en cents)
    const n = typeof e.amount === 'string' ? Number.parseFloat(e.amount) : e.amount
    if (Number.isFinite(n)) totalCents += Math.round(Math.abs(n) * 100)
  }

  // El archivo termina con CRLF tras la última línea, igual que el PHP.
  const content = lines.length > 0 ? `${lines.join('\r\n')}\r\n` : ''
  return {
    content,
    totalAmount: totalCents / 100,
    recordCount: entries.length,
  }
}
