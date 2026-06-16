import { amountToWords } from '@payroll/core/treasury'
/**
 * Renderer PDF de cheques.
 *
 * Genera un PDF con un cheque por página, posicionado para imprimirse
 * sobre formularios pre-impresos de banco panameño estándar (8.5" x
 * 3.5" — formato cheque). Las posiciones de cada elemento están
 * centradas para una distribución típica:
 *
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │ [Banco]                                  Cheque N° 00012345  │
 *   │                                                              │
 *   │                                      Fecha: 15 / 01 / 2026   │
 *   │                                                                │
 *   │ Páguese a la orden de:                            │ B/. *****│
 *   │ ─────────────────────────────────                 │ *250.50 *│
 *   │ DOSCIENTOS CINCUENTA BALBOAS CON 50/100                       │
 *   │                                                              │
 *   │ Concepto: Quincena 1 enero 2026                              │
 *   │ ───────────────                       ──────────────────     │
 *   │  Firma autorizada                      Firma autorizada      │
 *   └──────────────────────────────────────────────────────────────┘
 *
 * Para tenants que necesiten un layout distinto (algunos bancos
 * mueven la posición del MICR, el monto en letras, etc.) el
 * `CheckPdfLayout` permite override de cada coordenada en puntos
 * desde la esquina superior izquierda — sin tocar este renderer.
 *
 * Uso:
 *   import { renderToBuffer } from '@react-pdf/renderer'
 *   const buf = await renderToBuffer(<CheckPdf checks={...} />)
 */
import { Document, Page, StyleSheet, Text } from '@react-pdf/renderer'

// ─── Tipos públicos ──────────────────────────────────────────────────────

export type CheckPdfEntry = {
  /** Número de cheque ya asignado por la chequera. */
  checkNumber: number
  /** Nombre del banco (cabecera). Opcional. */
  bankName?: string
  /** Número de cuenta de la chequera. Opcional. */
  accountNumber?: string
  /** Fecha de emisión en YYYY-MM-DD. */
  issueDate: string
  beneficiaryName: string
  /** Monto numérico. Si trae string usa Number() para parsear. */
  amount: number | string
  /** Si no se pasa, se calcula con amountToWords(amount). */
  amountInWords?: string
  /** Texto que va en la línea "Concepto". Opcional. */
  concept?: string | null
}

/**
 * Coordenadas relativas a la esquina superior izquierda del cheque
 * en puntos (1 pt = 1/72 inch). El cheque ocupa toda la página, así
 * que las coordenadas son relativas al área de impresión.
 */
export type CheckPdfLayout = {
  pageWidth: number
  pageHeight: number
  checkNumber: { x: number; y: number; fontSize: number }
  date: { x: number; y: number; fontSize: number }
  beneficiary: { x: number; y: number; width: number; fontSize: number }
  amount: { x: number; y: number; fontSize: number }
  amountInWords: { x: number; y: number; width: number; fontSize: number }
  concept: { x: number; y: number; width: number; fontSize: number } | null
  header: { x: number; y: number; width: number; fontSize: number } | null
}

// Layout default: hoja de 8.5" x 11" (612 x 792 pt), un cheque por hoja
// centrado en la mitad superior. Margen suficiente para imprimirse
// sobre el cheque pre-impreso colocado en la bandeja superior.
export const DEFAULT_LAYOUT: CheckPdfLayout = {
  pageWidth: 612,
  pageHeight: 792,
  // Cheque típico ocupa 8.5" x 3.5" (612 x 252 pt) en el TOP de la hoja.
  // Coordenadas internas relativas a (0, 0) de ese rectángulo.
  header: { x: 36, y: 22, width: 540, fontSize: 9 },
  checkNumber: { x: 480, y: 22, fontSize: 14 },
  date: { x: 420, y: 60, fontSize: 11 },
  beneficiary: { x: 36, y: 105, width: 360, fontSize: 12 },
  amount: { x: 420, y: 105, fontSize: 14 },
  amountInWords: { x: 36, y: 135, width: 540, fontSize: 11 },
  concept: { x: 36, y: 170, width: 540, fontSize: 9 },
}

// ─── Estilos absolutos ───────────────────────────────────────────────────

const styles = StyleSheet.create({
  page: { backgroundColor: '#ffffff', fontFamily: 'Helvetica' },
  cell: { position: 'absolute' },
  cellMono: { position: 'absolute', fontFamily: 'Courier' },
  cellBold: { position: 'absolute', fontFamily: 'Helvetica-Bold' },
})

// ─── Helpers ─────────────────────────────────────────────────────────────

function fmtDate(s: string): string {
  if (!s) return ''
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return s
  return `${m[3]} / ${m[2]} / ${m[1]}`
}

function fmtAmount(amount: number | string): string {
  const n = typeof amount === 'string' ? Number.parseFloat(amount) : amount
  if (!Number.isFinite(n)) return ''
  // Estilo cheque: asteriscos alrededor para evitar alteración.
  const formatted = n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `***${formatted}***`
}

// ─── Component: un cheque por página ─────────────────────────────────────

function CheckPage({
  entry,
  layout,
}: {
  entry: CheckPdfEntry
  layout: CheckPdfLayout
}) {
  const words =
    entry.amountInWords && entry.amountInWords.trim().length > 0
      ? entry.amountInWords
      : amountToWords(entry.amount)

  return (
    <Page size={{ width: layout.pageWidth, height: layout.pageHeight }} style={styles.page}>
      {layout.header && (entry.bankName || entry.accountNumber) && (
        <Text
          style={{
            ...styles.cell,
            left: layout.header.x,
            top: layout.header.y,
            width: layout.header.width,
            fontSize: layout.header.fontSize,
            color: '#374151',
          }}
        >
          {[entry.bankName, entry.accountNumber && `Cta. ${entry.accountNumber}`]
            .filter(Boolean)
            .join('  ·  ')}
        </Text>
      )}

      <Text
        style={{
          ...styles.cellMono,
          left: layout.checkNumber.x,
          top: layout.checkNumber.y,
          fontSize: layout.checkNumber.fontSize,
          color: '#dc2626',
        }}
      >
        {String(entry.checkNumber).padStart(7, '0')}
      </Text>

      <Text
        style={{
          ...styles.cellMono,
          left: layout.date.x,
          top: layout.date.y,
          fontSize: layout.date.fontSize,
          letterSpacing: 2,
        }}
      >
        {fmtDate(entry.issueDate)}
      </Text>

      <Text
        style={{
          ...styles.cellBold,
          left: layout.beneficiary.x,
          top: layout.beneficiary.y,
          width: layout.beneficiary.width,
          fontSize: layout.beneficiary.fontSize,
        }}
      >
        {entry.beneficiaryName}
      </Text>

      <Text
        style={{
          ...styles.cellMono,
          left: layout.amount.x,
          top: layout.amount.y,
          fontSize: layout.amount.fontSize,
        }}
      >
        {fmtAmount(entry.amount)}
      </Text>

      <Text
        style={{
          ...styles.cellBold,
          left: layout.amountInWords.x,
          top: layout.amountInWords.y,
          width: layout.amountInWords.width,
          fontSize: layout.amountInWords.fontSize,
        }}
      >
        {`**${words}**`}
      </Text>

      {layout.concept && entry.concept && (
        <Text
          style={{
            ...styles.cell,
            left: layout.concept.x,
            top: layout.concept.y,
            width: layout.concept.width,
            fontSize: layout.concept.fontSize,
            color: '#374151',
          }}
        >
          {`Concepto: ${entry.concept}`}
        </Text>
      )}
    </Page>
  )
}

// ─── Document ─────────────────────────────────────────────────────────────

export function CheckPdf({
  checks,
  layout = DEFAULT_LAYOUT,
}: {
  checks: CheckPdfEntry[]
  layout?: CheckPdfLayout
}) {
  return (
    <Document
      title={`Cheques (${checks.length})`}
      author="RCG SOFTRIX"
      creator="RCG SOFTRIX Treasury"
    >
      {checks.map((c) => (
        <CheckPage key={`check-${c.checkNumber}`} entry={c} layout={layout} />
      ))}
    </Document>
  )
}
