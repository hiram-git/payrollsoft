import { amountToWords } from '@payroll/core/treasury'
/**
 * Renderer Excel de cheques — replica el layout posicional del
 * sistema PHP/PHPExcel original para que el contador pueda abrir
 * el .xlsx, alinear con su impresora matricial y mandar a imprimir
 * sobre formularios pre-impresos de cheque.
 *
 * La distribución de columnas y filas viene del PHP literal:
 *
 *   • Anchos de columna: A=33, B=12, C=20, D=25, E=3, F=3, G=10
 *   • Cada cheque ocupa ~18 filas con offsets fijos para:
 *       - B (con merge B:B+1): fecha simple "DD MM YYYY"
 *       - I (con merge I:K): fecha con espacios para alinear sobre
 *         los recuadros pre-impresos de día/mes/año
 *       - J (top): número de cheque
 *       - J (bottom): monto numérico repetido
 *       - A: monto con asteriscos como protección anti-alteración
 *       - D (con merge D:H): nombre del beneficiario
 *       - D (con merge D:H), siguiente fila: monto en letras
 *
 * Usa SheetJS (`xlsx`) — ya está en deps de apps/web.
 */
import * as XLSX from 'xlsx'

export type CheckXlsxEntry = {
  checkNumber: number
  issueDate: string
  beneficiaryName: string
  amount: number | string
  amountInWords?: string
}

const COLUMN_WIDTHS = [
  { wch: 33 }, // A
  { wch: 12 }, // B
  { wch: 20 }, // C
  { wch: 25 }, // D
  { wch: 3 }, // E
  { wch: 3 }, // F
  { wch: 10 }, // G
  { wch: 8 }, // H
  { wch: 12 }, // I
  { wch: 12 }, // J
  { wch: 12 }, // K
]

/**
 * Construye el "fecha espaciada" del PHP — un string como
 * "1    5     0    1      2      0    2    6" (DDMMYYYY)
 * con anchos crecientes que coinciden con los recuadros del
 * cheque pre-impreso típico.
 */
function spacedDate(yyyymmdd: string): string {
  // Aceptar "YYYY-MM-DD" o "YYYYMMDD"
  const compact = yyyymmdd.replace(/-/g, '')
  if (compact.length < 8) return compact
  // Reordenar a DDMMYYYY (lo que espera el formulario PA)
  const dd = compact.slice(6, 8)
  const mm = compact.slice(4, 6)
  const yyyy = compact.slice(0, 4)
  const ddmmyyyy = `${dd}${mm}${yyyy}`
  // Espacios entre dígitos: tomado del PHP original.
  const gaps = [0, 4, 5, 4, 6, 5, 4, 4]
  let out = ''
  for (let i = 0; i < ddmmyyyy.length; i++) {
    out += ' '.repeat(gaps[i] ?? 4) + ddmmyyyy[i]
  }
  return `${out}  `
}

function fmtSimpleDate(s: string): string {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return s
  return `${m[3]} ${m[2]} ${m[1]}`
}

function padAmount(amount: number | string): string {
  const n = typeof amount === 'string' ? Number.parseFloat(amount) : amount
  if (!Number.isFinite(n)) return '**********'
  // Formato cheque: monto con asteriscos a ambos lados (relleno)
  // hasta 10 chars, igual que el PHP `str_pad($monto, 10, '*', STR_PAD_BOTH)`.
  const raw = n.toFixed(2)
  if (raw.length >= 10) return `*${raw}*`
  const totalPad = 10 - raw.length
  const leftPad = Math.floor(totalPad / 2)
  const rightPad = totalPad - leftPad
  return '*'.repeat(leftPad) + raw + '*'.repeat(rightPad)
}

/**
 * Construye un workbook con un único worksheet conteniendo todos
 * los cheques apilados verticalmente, espaciados por ~18 filas
 * cada uno.
 *
 * Devuelve un `Buffer` listo para enviar como
 * `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`.
 */
export function generateCheckXlsx(checks: CheckXlsxEntry[]): Buffer {
  const ws: XLSX.WorkSheet = {}
  ws['!cols'] = COLUMN_WIDTHS
  ws['!merges'] = []
  ws['!ref'] = 'A1:K1'

  let rowCount = 1

  for (const c of checks) {
    const words =
      c.amountInWords && c.amountInWords.trim().length > 0
        ? c.amountInWords
        : amountToWords(c.amount)
    const dateSimple = fmtSimpleDate(c.issueDate)
    const dateSpaced = `   ${spacedDate(c.issueDate)}`
    const amountStr = padAmount(c.amount)

    // ── Avanzar 3 filas (como el PHP que hace rowCount++ tres veces) ────
    rowCount += 3

    // B<row>: fecha simple + merge B:B+1
    ws[`B${rowCount}`] = { t: 's', v: dateSimple }
    ws['!merges'].push({ s: { r: rowCount - 1, c: 1 }, e: { r: rowCount, c: 1 } })
    // I<row>: fecha espaciada + merge I:K span 2 filas
    ws[`I${rowCount}`] = { t: 's', v: dateSpaced }
    ws['!merges'].push({ s: { r: rowCount - 1, c: 8 }, e: { r: rowCount, c: 10 } })

    rowCount += 2
    // J<row>: número de cheque (esquina superior derecha del formulario)
    ws[`J${rowCount}`] = { t: 's', v: String(c.checkNumber).padStart(7, '0') }

    rowCount += 1
    // A<row>: monto con asteriscos (derecha-alineado por el ancho de col A)
    ws[`A${rowCount}`] = {
      t: 's',
      v: amountStr,
      s: { alignment: { horizontal: 'right' } },
    }
    // D<row>: beneficiario + merge D:H span 2 filas
    ws[`D${rowCount}`] = { t: 's', v: c.beneficiaryName }
    ws['!merges'].push({ s: { r: rowCount - 1, c: 3 }, e: { r: rowCount, c: 7 } })

    rowCount += 1
    // J<row>: monto numérico repetido (los formularios PA suelen tener
    // dos zonas para el monto — una al lado del nombre y otra al pie).
    ws[`J${rowCount}`] = { t: 's', v: amountStr }

    rowCount += 1
    // D<row>: monto en letras con asteriscos de inicio/fin, merge D:H
    ws[`D${rowCount}`] = { t: 's', v: `**${words}**` }
    ws['!merges'].push({ s: { r: rowCount - 1, c: 3 }, e: { r: rowCount, c: 7 } })

    // Avanzar al siguiente cheque (espacio en blanco entre cheques).
    rowCount += 9
  }

  // Establecer ref final del sheet
  const lastRow = Math.max(rowCount, 1)
  ws['!ref'] = `A1:K${lastRow}`

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Cheques')

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
  return buf as Buffer
}
