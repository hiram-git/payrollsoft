import { Document, Font, Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer'

// ─── Types ────────────────────────────────────────────────────────────────────

export type PdfLineConceptEntry = {
  code: string
  name: string
  type: string
  amount: number
}

export type PdfPayrollLine = {
  line: {
    grossAmount: string
    deductions: string
    netAmount: string
    concepts: PdfLineConceptEntry[]
  }
  employee: {
    id: string
    code: string
    idNumber?: string | null
    firstName: string
    lastName: string
    department: string | null
    position: string | null
  }
}

export type PdfPayroll = {
  id: string
  name: string
  type: string
  frequency: string
  periodStart: string
  periodEnd: string
  paymentDate: string | null
  status: string
  totalGross: string
  totalDeductions: string
  totalNet: string
}

export type PdfCompany = {
  companyName: string | null
  logoEmpresa: string | null
  elaboradoPor: string | null
  cargoElaborador: string | null
  jefeRecursosHumanos: string | null
  cargoJefeRrhh: string | null
  directorGeneral?: string | null
  cargoDirector?: string | null
}

// ─── Fonts ────────────────────────────────────────────────────────────────────

Font.registerHyphenationCallback((word) => [word])

// ─── Palette ─────────────────────────────────────────────────────────────────

const C = {
  black: '#111827',
  gray700: '#374151',
  gray500: '#6b7280',
  gray400: '#9ca3af',
  gray300: '#d1d5db',
  gray200: '#e5e7eb',
  gray100: '#f3f4f6',
  gray50: '#f9fafb',
  blue700: '#1d4ed8',
  blue50: '#eff6ff',
  emerald700: '#047857',
  emerald50: '#ecfdf5',
  red600: '#dc2626',
  red50: '#fef2f2',
  white: '#ffffff',
  navy: '#0f172a',
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  page: {
    fontFamily: 'Helvetica',
    fontSize: 8,
    color: C.black,
    paddingTop: 28,
    paddingBottom: 40,
    paddingHorizontal: 24,
  },
  // ── Header ──
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    gap: 12,
  },
  logoBox: {
    width: 54,
    height: 54,
    borderWidth: 1,
    borderColor: C.gray300,
    borderRadius: 4,
    backgroundColor: C.gray50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoPlaceholder: {
    fontSize: 7,
    color: C.gray400,
    fontFamily: 'Helvetica-Bold',
    letterSpacing: 1,
  },
  headerMiddle: {
    flex: 1,
    alignItems: 'center',
  },
  companyName: {
    fontSize: 12,
    fontFamily: 'Helvetica-Bold',
    color: C.navy,
    marginBottom: 2,
  },
  reportTitle: {
    fontSize: 14,
    fontFamily: 'Helvetica-Bold',
    color: C.black,
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  periodLine: {
    fontSize: 8.5,
    color: C.gray700,
  },
  headerSpacer: {
    width: 54,
  },
  divider: { borderBottomWidth: 1, borderBottomColor: C.gray300, marginBottom: 10 },

  // ── Table ──
  table: { flexDirection: 'column' },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: C.navy,
    paddingVertical: 5,
    paddingHorizontal: 4,
  },
  th: {
    fontSize: 7,
    fontFamily: 'Helvetica-Bold',
    color: C.white,
    textTransform: 'uppercase',
    paddingHorizontal: 2,
  },
  tr: {
    flexDirection: 'row',
    paddingVertical: 4,
    paddingHorizontal: 4,
    borderBottomWidth: 0.5,
    borderBottomColor: C.gray200,
  },
  trAlt: { backgroundColor: C.gray50 },
  td: { fontSize: 7.5, paddingHorizontal: 2 },
  tdMuted: { color: C.gray500 },

  // Column widths (A4 landscape usable width ≈ 794 pt after 24pt margins)
  colEmployee: { width: '16%' },
  colCedula: { width: '9%' },
  colSueldo: { width: '8%', textAlign: 'right' },
  colIngresos: { width: '8%', textAlign: 'right' },
  colSS: { width: '8%', textAlign: 'right' },
  colSE: { width: '8%', textAlign: 'right' },
  colSiacap: { width: '8%', textAlign: 'right' },
  colIsr: { width: '8%', textAlign: 'right' },
  colOtras: { width: '10%', textAlign: 'right' },
  colNeto: { width: '9%', textAlign: 'right' },

  // ── Totals row ──
  totalsRow: {
    flexDirection: 'row',
    paddingVertical: 6,
    paddingHorizontal: 4,
    backgroundColor: C.gray100,
    borderTopWidth: 1,
    borderTopColor: C.navy,
    marginTop: 2,
  },
  tdTotal: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    paddingHorizontal: 2,
  },

  // ── Signatures ──
  signatureSection: {
    marginTop: 36,
    flexDirection: 'row',
    gap: 20,
  },
  signatureBlock: {
    flex: 1,
    alignItems: 'center',
  },
  signatureLabel: {
    fontSize: 7,
    color: C.gray500,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 30,
  },
  signatureLine: {
    borderTopWidth: 1,
    borderTopColor: C.gray700,
    width: '90%',
    paddingTop: 4,
    alignItems: 'center',
  },
  signatureName: { fontSize: 8.5, fontFamily: 'Helvetica-Bold', color: C.black },
  signatureRole: { fontSize: 7.5, color: C.gray500, marginTop: 1 },

  // ── Footer ──
  footer: {
    position: 'absolute',
    bottom: 16,
    left: 24,
    right: 24,
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 0.5,
    borderTopColor: C.gray300,
    paddingTop: 4,
  },
  footerText: { fontSize: 6.5, color: C.gray500 },
})

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(v: number) {
  return v.toLocaleString('es-PA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function toNumber(v: string | number | undefined | null): number {
  if (v === undefined || v === null) return 0
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

function formatDateISO(iso: string): string {
  // Input is YYYY-MM-DD; output DD-MM-YYYY (avoids locale/timezone surprises).
  const [y, m, d] = iso.split('-')
  if (!y || !m || !d) return iso
  return `${d}-${m}-${y}`
}

const TYPE_LABEL: Record<string, string> = {
  regular: 'REGULAR',
  thirteenth: 'XIII MES',
  special: 'ESPECIAL',
}

/**
 * Canonical concept codes for Panamá legal deductions. Creditor-linked
 * deductions are identified separately by the `ACR_` code prefix the
 * creditors service assigns (see `createCreditorService` in the API).
 */
const CODE = {
  sueldo: new Set(['SUELDO', 'SALARIO', 'SALARIO_BASE']),
  ss: new Set(['SS', 'SEGURO_SOCIAL', 'CSS']),
  se: new Set(['SE', 'SEGURO_EDUCATIVO', 'SEDU']),
  siacap: new Set(['SIACAP']),
  isr: new Set(['ISR', 'ISLR', 'IMP_RENTA', 'IMPUESTO_RENTA']),
}

const CREDITOR_CODE_PREFIX = 'ACR_'

/**
 * Split a line's concepts into the 8 numeric buckets the planilla needs.
 * Exposed as a pure function so tests and callers can reuse the same math.
 *
 * `otrasDeducciones` accumulates only creditor-linked concepts (ACR_*) so
 * the column reflects cuotas de acreedores. `neto` is derived as
 * `ingresos - (ss + se + siacap + isr + otrasDeducciones)`; any tenant-
 * defined deduction outside the legal set and not linked to a creditor is
 * intentionally excluded from both otrasDeducciones and neto, matching the
 * official Planilla de Sueldos spec.
 */
export function computePayrollPdfBuckets(line: PdfPayrollLine['line']): {
  sueldo: number
  ingresos: number
  ss: number
  se: number
  siacap: number
  isr: number
  otrasDeducciones: number
  neto: number
} {
  let sueldo = 0
  let ingresos = 0
  let ss = 0
  let se = 0
  let siacap = 0
  let isr = 0
  let otrasDeducciones = 0

  for (const c of line.concepts) {
    const code = c.code?.toUpperCase() ?? ''
    const amount = toNumber(c.amount)

    if (c.type === 'income') {
      ingresos += amount
      if (CODE.sueldo.has(code)) sueldo = amount
      continue
    }

    if (c.type === 'deduction') {
      if (CODE.ss.has(code)) {
        ss += amount
      } else if (CODE.se.has(code)) {
        se += amount
      } else if (CODE.siacap.has(code)) {
        siacap += amount
      } else if (CODE.isr.has(code)) {
        isr += amount
      } else if (code.startsWith(CREDITOR_CODE_PREFIX)) {
        otrasDeducciones += amount
      }
      // Any other deduction (tenant-specific, non-creditor, non-legal) is
      // intentionally skipped — it doesn't fit any column of the spec.
    }
  }

  // If the tenant has no explicit SUELDO concept, fall back to the full gross —
  // in that case "Sueldo" and "Ingresos" happen to be equal.
  if (sueldo === 0) sueldo = ingresos

  const neto = ingresos - (ss + se + siacap + isr + otrasDeducciones)
  return { sueldo, ingresos, ss, se, siacap, isr, otrasDeducciones, neto }
}

// ─── Document ─────────────────────────────────────────────────────────────────

export function PayrollPdf({
  payroll,
  lines,
  company,
}: {
  payroll: PdfPayroll
  lines: PdfPayrollLine[]
  company: PdfCompany | null
}) {
  const buckets = lines.map((l) => ({
    line: l,
    ...computePayrollPdfBuckets(l.line),
  }))

  const totals = buckets.reduce(
    (acc, b) => {
      acc.sueldo += b.sueldo
      acc.ingresos += b.ingresos
      acc.ss += b.ss
      acc.se += b.se
      acc.siacap += b.siacap
      acc.isr += b.isr
      acc.otrasDeducciones += b.otrasDeducciones
      acc.neto += b.neto
      return acc
    },
    { sueldo: 0, ingresos: 0, ss: 0, se: 0, siacap: 0, isr: 0, otrasDeducciones: 0, neto: 0 }
  )

  const generatedAt = new Date().toLocaleString('es-PA', {
    dateStyle: 'medium',
    timeStyle: 'medium',
  })

  const companyName = company?.companyName ?? 'Empresa'
  const logo = company?.logoEmpresa ?? null
  const typeLabel = TYPE_LABEL[payroll.type] ?? payroll.type.toUpperCase()
  const reportTitle = `PLANILLA ${typeLabel}`
  const periodLine = `Desde ${formatDateISO(payroll.periodStart)} hasta ${formatDateISO(payroll.periodEnd)}`

  const elaborador = {
    name: company?.elaboradoPor ?? '',
    role: company?.cargoElaborador ?? 'Especialista en Nóminas',
  }
  const revisor = {
    name: company?.jefeRecursosHumanos ?? '',
    role: company?.cargoJefeRrhh ?? 'Jefe de Recursos Humanos',
  }
  const autorizador = {
    name: company?.directorGeneral ?? '',
    role: company?.cargoDirector ?? 'Director General',
  }

  return (
    <Document title={reportTitle} author="PayrollSoft" subject={payroll.name}>
      <Page size="A4" style={s.page} orientation="landscape" wrap>
        {/* ── Header (repeats on every page) ── */}
        <View style={s.header} fixed>
          <View style={s.logoBox}>
            {logo ? (
              <Image src={logo} style={{ width: 48, height: 48, objectFit: 'contain' }} />
            ) : (
              <Text style={s.logoPlaceholder}>LOGO</Text>
            )}
          </View>
          <View style={s.headerMiddle}>
            <Text style={s.companyName}>{companyName}</Text>
            <Text style={s.reportTitle}>{reportTitle}</Text>
            <Text style={s.periodLine}>{periodLine}</Text>
          </View>
          {/* Balanced spacer mirrors the logo width so the title stays
              visually centred on the page. */}
          <View style={s.headerSpacer} />
        </View>

        <View style={s.divider} fixed />

        {/* ── Table ── */}
        <View style={s.table}>
          {/* Header row (repeats every page via `fixed`) */}
          <View style={s.tableHeader} fixed>
            <Text style={[s.th, s.colEmployee]}>Empleado</Text>
            <Text style={[s.th, s.colCedula]}>Cédula</Text>
            <Text style={[s.th, s.colSueldo]}>Sueldo</Text>
            <Text style={[s.th, s.colIngresos]}>Ingresos</Text>
            <Text style={[s.th, s.colSS]}>Seg. Social</Text>
            <Text style={[s.th, s.colSE]}>Seg. Edu.</Text>
            <Text style={[s.th, s.colSiacap]}>SIACAP</Text>
            <Text style={[s.th, s.colIsr]}>ISR</Text>
            <Text style={[s.th, s.colOtras]}>Otras Ded.</Text>
            <Text style={[s.th, s.colNeto]}>Neto</Text>
          </View>

          {/* Body rows */}
          {buckets.map((b, i) => {
            const emp = b.line.employee
            const fullName = `${emp.firstName} ${emp.lastName}`.trim()
            return (
              <View key={emp.code} style={[s.tr, i % 2 === 1 ? s.trAlt : {}]} wrap={false}>
                <Text style={[s.td, s.colEmployee]}>{fullName}</Text>
                <Text style={[s.td, s.colCedula, s.tdMuted]}>{emp.idNumber ?? '—'}</Text>
                <Text style={[s.td, s.colSueldo]}>{fmt(b.sueldo)}</Text>
                <Text style={[s.td, s.colIngresos]}>{fmt(b.ingresos)}</Text>
                <Text style={[s.td, s.colSS]}>{fmt(b.ss)}</Text>
                <Text style={[s.td, s.colSE]}>{fmt(b.se)}</Text>
                <Text style={[s.td, s.colSiacap]}>{fmt(b.siacap)}</Text>
                <Text style={[s.td, s.colIsr]}>{fmt(b.isr)}</Text>
                <Text style={[s.td, s.colOtras]}>{fmt(b.otrasDeducciones)}</Text>
                <Text style={[s.td, s.colNeto, { fontFamily: 'Helvetica-Bold' }]}>
                  {fmt(b.neto)}
                </Text>
              </View>
            )
          })}

          {/* Totals row */}
          <View style={s.totalsRow} wrap={false}>
            <Text style={[s.tdTotal, s.colEmployee]}>TOTALES</Text>
            <Text style={[s.tdTotal, s.colCedula, s.tdMuted]}>{lines.length} emp.</Text>
            <Text style={[s.tdTotal, s.colSueldo]}>{fmt(totals.sueldo)}</Text>
            <Text style={[s.tdTotal, s.colIngresos]}>{fmt(totals.ingresos)}</Text>
            <Text style={[s.tdTotal, s.colSS]}>{fmt(totals.ss)}</Text>
            <Text style={[s.tdTotal, s.colSE]}>{fmt(totals.se)}</Text>
            <Text style={[s.tdTotal, s.colSiacap]}>{fmt(totals.siacap)}</Text>
            <Text style={[s.tdTotal, s.colIsr]}>{fmt(totals.isr)}</Text>
            <Text style={[s.tdTotal, s.colOtras]}>{fmt(totals.otrasDeducciones)}</Text>
            <Text style={[s.tdTotal, s.colNeto, { color: C.emerald700 }]}>{fmt(totals.neto)}</Text>
          </View>
        </View>

        {/* ── Signatures ── */}
        <View style={s.signatureSection} wrap={false}>
          {[
            { label: 'Elaborado por', ...elaborador },
            { label: 'Revisado por', ...revisor },
            { label: 'Autorizado por', ...autorizador },
          ].map((sig) => (
            <View key={sig.label} style={s.signatureBlock}>
              <Text style={s.signatureLabel}>{sig.label}</Text>
              <View style={s.signatureLine}>
                <Text style={s.signatureName}>{sig.name || ' '}</Text>
                <Text style={s.signatureRole}>{sig.role}</Text>
              </View>
            </View>
          ))}
        </View>

        {/* ── Footer ── */}
        <View style={s.footer} fixed>
          <Text style={s.footerText}>Generado: {generatedAt}</Text>
          <Text style={s.footerText}>
            {companyName} — {payroll.name}
          </Text>
          <Text
            style={s.footerText}
            render={({ pageNumber, totalPages }) => `Página ${pageNumber} de ${totalPages}`}
          />
        </View>
      </Page>
    </Document>
  )
}
