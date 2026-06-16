import { Document, Font, Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer'

// ─── Types ────────────────────────────────────────────────────────────────────

export type PdfCreditorDetail = {
  conceptCode: string
  amount: string
  payrollName: string
  periodStart: string
  periodEnd: string
  employeeId: string
  employeeCode: string
  firstName: string
  lastName: string
}

export type PdfCreditorsExtraColumn = {
  name: string
  /** valores por empleado (employeeId → string formateado) */
  valuesByEmployee: Record<string, string>
}

export type PdfCreditorBucket = {
  creditorCode: string
  creditorName: string
  total: string
  employeeCount: number
  installmentCount: number
  details: PdfCreditorDetail[]
}

export type PdfCreditorsReport = {
  year: number
  month: number
  rangeFrom: string
  rangeTo: string
  grandTotal: string
  creditorCount: number
  installmentCount: number
  creditors: PdfCreditorBucket[]
}

export type PdfCompany = {
  companyName: string | null
  ruc: string | null
  companyLogo: string | null
}

export type PdfGeneratedBy = {
  name: string | null
  email: string | null
}

// ─── Setup ────────────────────────────────────────────────────────────────────

Font.registerHyphenationCallback((word) => [word])

const C = {
  black: '#111827',
  gray700: '#374151',
  gray500: '#6b7280',
  gray400: '#9ca3af',
  gray300: '#d1d5db',
  gray200: '#e5e7eb',
  gray100: '#f3f4f6',
  gray50: '#f9fafb',
  red600: '#dc2626',
  white: '#ffffff',
  navy: '#0f172a',
  navySoft: '#e0e7ff',
}

const MONTHS = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
]

const s = StyleSheet.create({
  page: {
    fontFamily: 'Helvetica',
    fontSize: 8,
    color: C.black,
    paddingTop: 28,
    paddingBottom: 40,
    paddingHorizontal: 24,
  },

  // Header
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 10, gap: 12 },
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
  headerMiddle: { flex: 1, alignItems: 'center' },
  companyName: { fontSize: 12, fontFamily: 'Helvetica-Bold', color: C.navy, marginBottom: 2 },
  reportTitle: {
    fontSize: 14,
    fontFamily: 'Helvetica-Bold',
    color: C.black,
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  periodLine: { fontSize: 8.5, color: C.gray700 },
  headerSpacer: { width: 54 },
  divider: { borderBottomWidth: 1, borderBottomColor: C.gray300, marginBottom: 10 },

  // KPIs row
  kpiRow: { flexDirection: 'row', gap: 6, marginBottom: 12 },
  kpi: {
    flex: 1,
    borderWidth: 0.7,
    borderColor: C.gray300,
    borderRadius: 4,
    paddingVertical: 6,
    paddingHorizontal: 8,
    backgroundColor: C.gray50,
  },
  kpiLabel: {
    fontSize: 6.5,
    color: C.gray500,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  kpiValue: { fontSize: 11, fontFamily: 'Helvetica-Bold', color: C.navy },
  kpiSub: { fontSize: 6.5, color: C.gray500, marginTop: 1 },

  // Summary table
  sectionTitle: {
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
    color: C.navy,
    marginBottom: 6,
    marginTop: 4,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  table: { flexDirection: 'column', marginBottom: 10 },
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

  // Summary columns
  sumColCode: { width: '12%' },
  sumColName: { width: '50%' },
  sumColCount: { width: '11%', textAlign: 'right' },
  sumColInst: { width: '12%', textAlign: 'right' },
  sumColTotal: { width: '15%', textAlign: 'right' },

  // Grand total row
  grandTotalRow: {
    flexDirection: 'row',
    paddingVertical: 6,
    paddingHorizontal: 4,
    backgroundColor: C.navySoft,
    borderTopWidth: 1.2,
    borderTopColor: C.navy,
  },
  tdTotal: { fontSize: 8.5, fontFamily: 'Helvetica-Bold', paddingHorizontal: 2, color: C.navy },

  // Per-creditor section
  creditorBlock: { marginBottom: 12 },
  creditorHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: C.gray100,
    borderLeftWidth: 3,
    borderLeftColor: C.navy,
    paddingVertical: 4,
    paddingHorizontal: 6,
    marginBottom: 2,
  },
  creditorHeadLeft: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  creditorCode: { fontSize: 7, fontFamily: 'Helvetica-Bold', color: C.gray500 },
  creditorName: { fontSize: 9, fontFamily: 'Helvetica-Bold', color: C.navy },
  creditorMeta: { fontSize: 7, color: C.gray500 },
  creditorTotal: { fontSize: 9.5, fontFamily: 'Helvetica-Bold', color: C.navy },

  // Detail columns
  detColEmp: { width: '28%' },
  detColCedula: { width: '12%' },
  detColPayroll: { width: '20%' },
  detColPeriod: { width: '20%' },
  detColConcept: { width: '10%' },
  detColAmount: { width: '10%', textAlign: 'right' },

  // Footer
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtMoney(v: string | number) {
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  return n.toLocaleString('es-PA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDateISO(iso: string): string {
  if (!iso) return '—'
  const [y, m, d] = iso.slice(0, 10).split('-')
  if (!y || !m || !d) return iso
  return `${d}-${m}-${y}`
}

// ─── Document ─────────────────────────────────────────────────────────────────

export function CreditorsPdf({
  report,
  company,
  generatedBy,
  extraColumns = [],
}: {
  report: PdfCreditorsReport
  company: PdfCompany | null
  extraColumns?: PdfCreditorsExtraColumn[]
  generatedBy?: PdfGeneratedBy | null
}) {
  const generatedAt = new Date().toLocaleString('es-PA', {
    dateStyle: 'medium',
    timeStyle: 'medium',
  })
  const companyName = company?.companyName ?? 'Empresa'
  const logo = company?.companyLogo ?? null
  const monthLabel = MONTHS[report.month - 1] ?? String(report.month)
  const reportTitle = `ACREEDORES — ${monthLabel.toUpperCase()} ${report.year}`

  // Anchos de columnas del detalle. Cuando hay columnas extra activas
  // (campos adicionales marcados con `includeInCreditorsReport=true`),
  // redistribuimos el espacio horizontal de las columnas base para que
  // las extras quepan en A4-horizontal sin desbordar.
  const extraCount = extraColumns.length
  const extraWidth = extraCount > 0 ? 8 : 0
  const baseBudget = 100 - extraWidth * extraCount
  const baseTotal = 100 // anchos originales suman 100%
  const scale = baseBudget / baseTotal
  const extraStyles = {
    emp: { width: `${28 * scale}%` },
    cedula: { width: `${12 * scale}%` },
    payroll: { width: `${20 * scale}%` },
    period: { width: `${20 * scale}%` },
    concept: { width: `${10 * scale}%` },
    extra: { width: `${extraWidth}%` },
    amount: { width: `${10 * scale}%`, textAlign: 'right' as const },
  }

  return (
    <Document
      title={`Acreedores ${monthLabel} ${report.year}`}
      author="RCG SOFTRIX"
      subject="Reporte mensual de acreedores"
    >
      <Page size="A4" style={s.page} orientation="landscape" wrap>
        {/* Header — repite en cada página */}
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
            <Text style={s.periodLine}>
              Período {fmtDateISO(report.rangeFrom)} → {fmtDateISO(report.rangeTo)} · Generado el{' '}
              {generatedAt}
            </Text>
          </View>
          <View style={s.headerSpacer} />
        </View>

        <View style={s.divider} fixed />

        {/* KPIs */}
        <View style={s.kpiRow}>
          <View style={s.kpi}>
            <Text style={s.kpiLabel}>Total a transferir</Text>
            <Text style={s.kpiValue}>B/. {fmtMoney(report.grandTotal)}</Text>
            <Text style={s.kpiSub}>
              {monthLabel} {report.year}
            </Text>
          </View>
          <View style={s.kpi}>
            <Text style={s.kpiLabel}>Acreedores</Text>
            <Text style={s.kpiValue}>{report.creditorCount}</Text>
          </View>
          <View style={s.kpi}>
            <Text style={s.kpiLabel}>Cuotas / descuentos</Text>
            <Text style={s.kpiValue}>{report.installmentCount}</Text>
          </View>
        </View>

        {/* Resumen por acreedor */}
        <Text style={s.sectionTitle}>Resumen por acreedor</Text>
        <View style={s.table}>
          <View style={s.tableHeader} fixed>
            <Text style={[s.th, s.sumColCode]}>Código</Text>
            <Text style={[s.th, s.sumColName]}>Acreedor</Text>
            <Text style={[s.th, s.sumColCount]}>Empleados</Text>
            <Text style={[s.th, s.sumColInst]}>Cuotas</Text>
            <Text style={[s.th, s.sumColTotal]}>Total (B/.)</Text>
          </View>
          {report.creditors.map((c, i) => (
            <View
              key={`sum-${c.creditorCode}`}
              style={[s.tr, i % 2 === 1 ? s.trAlt : {}]}
              wrap={false}
            >
              <Text style={[s.td, s.sumColCode, s.tdMuted]}>{c.creditorCode}</Text>
              <Text style={[s.td, s.sumColName]}>{c.creditorName}</Text>
              <Text style={[s.td, s.sumColCount]}>{c.employeeCount}</Text>
              <Text style={[s.td, s.sumColInst]}>{c.installmentCount}</Text>
              <Text style={[s.td, s.sumColTotal]}>{fmtMoney(c.total)}</Text>
            </View>
          ))}
          <View style={s.grandTotalRow} wrap={false}>
            <Text style={[s.tdTotal, s.sumColCode]}> </Text>
            <Text style={[s.tdTotal, s.sumColName]}>TOTAL GENERAL</Text>
            <Text style={[s.tdTotal, s.sumColCount]}>
              {report.creditors.reduce((acc, c) => acc + c.employeeCount, 0)}
            </Text>
            <Text style={[s.tdTotal, s.sumColInst]}>{report.installmentCount}</Text>
            <Text style={[s.tdTotal, s.sumColTotal]}>{fmtMoney(report.grandTotal)}</Text>
          </View>
        </View>

        {/* Detalle por acreedor */}
        {report.creditors.length > 0 && <Text style={s.sectionTitle}>Detalle por acreedor</Text>}
        {report.creditors.map((c) => (
          <View key={`det-${c.creditorCode}`} style={s.creditorBlock}>
            <View style={s.creditorHead} wrap={false}>
              <View style={s.creditorHeadLeft}>
                <Text style={s.creditorCode}>{c.creditorCode}</Text>
                <Text style={s.creditorName}>{c.creditorName}</Text>
                <Text style={s.creditorMeta}>
                  · {c.employeeCount} {c.employeeCount === 1 ? 'empleado' : 'empleados'} ·{' '}
                  {c.installmentCount} {c.installmentCount === 1 ? 'cuota' : 'cuotas'}
                </Text>
              </View>
              <Text style={s.creditorTotal}>B/. {fmtMoney(c.total)}</Text>
            </View>
            <View style={s.tableHeader}>
              <Text style={[s.th, extraStyles.emp]}>Empleado</Text>
              <Text style={[s.th, extraStyles.cedula]}>Cód. empleado</Text>
              <Text style={[s.th, extraStyles.payroll]}>Planilla</Text>
              <Text style={[s.th, extraStyles.period]}>Período</Text>
              <Text style={[s.th, extraStyles.concept]}>Concepto</Text>
              {extraColumns.map((col) => (
                <Text key={`th-${col.name}`} style={[s.th, extraStyles.extra]}>
                  {col.name}
                </Text>
              ))}
              <Text style={[s.th, extraStyles.amount]}>Monto (B/.)</Text>
            </View>
            {c.details.map((d, i) => (
              <View
                key={`d-${c.creditorCode}-${i}`}
                style={[s.tr, i % 2 === 1 ? s.trAlt : {}]}
                wrap={false}
              >
                <Text style={[s.td, extraStyles.emp]}>
                  {d.lastName}, {d.firstName}
                </Text>
                <Text style={[s.td, extraStyles.cedula, s.tdMuted]}>{d.employeeCode}</Text>
                <Text style={[s.td, extraStyles.payroll]}>{d.payrollName}</Text>
                <Text style={[s.td, extraStyles.period, s.tdMuted]}>
                  {fmtDateISO(d.periodStart)} → {fmtDateISO(d.periodEnd)}
                </Text>
                <Text style={[s.td, extraStyles.concept, s.tdMuted]}>{d.conceptCode}</Text>
                {extraColumns.map((col) => (
                  <Text key={`c-${col.name}-${i}`} style={[s.td, extraStyles.extra, s.tdMuted]}>
                    {col.valuesByEmployee[d.employeeId] ?? '—'}
                  </Text>
                ))}
                <Text style={[s.td, extraStyles.amount, { color: C.red600 }]}>
                  −{fmtMoney(d.amount)}
                </Text>
              </View>
            ))}
          </View>
        ))}

        {/* Footer fijo */}
        <View style={s.footer} fixed>
          <Text style={s.footerText}>
            {generatedBy?.name
              ? `Generado por ${generatedBy.name}${
                  generatedBy.email ? ` (${generatedBy.email})` : ''
                }`
              : 'RCG SOFTRIX'}
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
