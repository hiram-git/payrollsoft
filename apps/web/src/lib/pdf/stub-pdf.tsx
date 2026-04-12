import { Document, Font, Page, StyleSheet, Text, View } from '@react-pdf/renderer'

// ─── Types ────────────────────────────────────────────────────────────────────

export type StubConceptEntry = {
  code: string
  name: string
  type: string
  amount: number
  formulaError?: string
}

export type StubLine = {
  grossAmount: string
  deductions: string
  netAmount: string
  concepts: StubConceptEntry[]
}

export type StubEmployee = {
  code: string
  firstName: string
  lastName: string
  department: string | null
  position: string | null
}

export type StubPayroll = {
  name: string
  type: string
  frequency: string
  periodStart: string
  periodEnd: string
  paymentDate: string | null
  status: string
}

// ─── Fonts ────────────────────────────────────────────────────────────────────

Font.registerHyphenationCallback((word) => [word])

// ─── Palette ─────────────────────────────────────────────────────────────────

const C = {
  black: '#111827',
  gray800: '#1f2937',
  gray700: '#374151',
  gray600: '#4b5563',
  gray500: '#6b7280',
  gray400: '#9ca3af',
  gray300: '#d1d5db',
  gray200: '#e5e7eb',
  gray100: '#f3f4f6',
  gray50: '#f9fafb',
  blue800: '#1e40af',
  blue700: '#1d4ed8',
  blue600: '#2563eb',
  blue100: '#dbeafe',
  blue50: '#eff6ff',
  red700: '#b91c1c',
  red600: '#dc2626',
  red100: '#fee2e2',
  red50: '#fef2f2',
  amber700: '#b45309',
  amber100: '#fde68a',
  amber50: '#fffbeb',
  emerald700: '#047857',
  emerald50: '#ecfdf5',
  white: '#ffffff',
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  page: {
    fontFamily: 'Helvetica',
    fontSize: 8,
    color: C.black,
    paddingTop: 36,
    paddingBottom: 56,
    paddingHorizontal: 44,
  },
  // ── Header ──
  headerBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 14,
  },
  appName: {
    fontSize: 13,
    fontFamily: 'Helvetica-Bold',
    color: C.black,
    marginBottom: 1,
  },
  docTitle: {
    fontSize: 9,
    color: C.gray600,
  },
  payrollBlock: {
    alignItems: 'flex-end',
  },
  payrollName: {
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
    color: C.gray800,
    marginBottom: 2,
    textAlign: 'right',
  },
  metaLine: {
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'flex-end',
    marginBottom: 1,
  },
  metaLabel: { fontSize: 7, color: C.gray500 },
  metaValue: { fontSize: 7, color: C.gray700 },
  dividerHeavy: {
    borderBottomWidth: 2,
    borderBottomColor: C.gray800,
    marginBottom: 10,
  },
  // ── Employee info ──
  empBox: {
    backgroundColor: C.gray50,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: C.gray200,
    padding: 10,
    marginBottom: 14,
    flexDirection: 'row',
    gap: 20,
  },
  empGroup: { flex: 1 },
  empField: { flexDirection: 'row', gap: 4, marginBottom: 3 },
  empLabel: { fontSize: 7, color: C.gray500, width: 70 },
  empValue: { fontSize: 7.5, color: C.gray800, flex: 1, fontFamily: 'Helvetica-Bold' },
  empValueNormal: { fontSize: 7.5, color: C.gray800, flex: 1 },
  // ── Totals ──
  totalsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 14,
  },
  totalCard: {
    flex: 1,
    borderRadius: 4,
    padding: 8,
    borderWidth: 1,
    borderColor: C.gray200,
    backgroundColor: C.gray50,
  },
  totalLabel: {
    fontSize: 6.5,
    color: C.gray500,
    textTransform: 'uppercase',
    marginBottom: 3,
  },
  totalValue: {
    fontSize: 11,
    fontFamily: 'Helvetica-Bold',
  },
  // ── Concept section ──
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 3,
    marginBottom: 1,
  },
  sectionTitle: {
    fontSize: 7.5,
    fontFamily: 'Helvetica-Bold',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  tableHeaderRow: {
    flexDirection: 'row',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: C.gray200,
  },
  thCell: {
    fontSize: 6.5,
    fontFamily: 'Helvetica-Bold',
    color: C.gray500,
    textTransform: 'uppercase',
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: C.gray100,
  },
  tableRowAlt: { backgroundColor: C.gray50 },
  tdCode: { width: 60, fontSize: 7, fontFamily: 'Helvetica-Bold', color: C.gray500 },
  tdName: { flex: 1, fontSize: 7.5 },
  tdAmount: { width: 72, fontSize: 7.5, textAlign: 'right', fontFamily: 'Helvetica-Bold' },
  subtotalRow: {
    flexDirection: 'row',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderTopWidth: 1,
  },
  subtotalLabel: {
    flex: 1,
    fontSize: 7,
    fontFamily: 'Helvetica-Bold',
    textAlign: 'right',
    paddingRight: 8,
  },
  subtotalValue: { width: 72, fontSize: 7.5, fontFamily: 'Helvetica-Bold', textAlign: 'right' },
  sectionWrapper: {
    borderWidth: 1,
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 10,
  },
  // ── Signatures ──
  sigSection: {
    position: 'absolute',
    bottom: 28,
    left: 44,
    right: 44,
    flexDirection: 'row',
    gap: 32,
  },
  sigBlock: { flex: 1 },
  sigLine: {
    borderTopWidth: 1,
    borderTopColor: C.gray400,
    marginTop: 28,
    paddingTop: 4,
  },
  sigLabel: { fontSize: 6.5, color: C.gray500, textAlign: 'center' },
  // ── Footer ──
  footer: {
    position: 'absolute',
    bottom: 16,
    left: 44,
    right: 44,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  footerText: { fontSize: 6, color: C.gray400 },
})

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(v: string | number) {
  return Number(v).toLocaleString('es-PA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function sum(entries: StubConceptEntry[]) {
  return entries.reduce((acc, c) => acc + Number(c.amount), 0)
}

const TYPE_LABEL: Record<string, string> = {
  regular: 'Regular',
  thirteenth: 'XIII Mes',
  special: 'Especial',
}
const FREQ_LABEL: Record<string, string> = {
  biweekly: 'Quincenal',
  monthly: 'Mensual',
  weekly: 'Semanal',
}

// ─── Concept section component ────────────────────────────────────────────────

function ConceptSection({
  title,
  entries,
  headerBg,
  headerText,
  subtotalColor,
  amountColor,
  subtotalBg,
  subtotalBorder,
}: {
  title: string
  entries: StubConceptEntry[]
  headerBg: string
  headerText: string
  subtotalColor: string
  amountColor: string
  subtotalBg: string
  subtotalBorder: string
}) {
  if (entries.length === 0) return null

  return (
    <View style={[s.sectionWrapper, { borderColor: subtotalBorder }]}>
      <View style={[s.sectionHeader, { backgroundColor: headerBg }]}>
        <Text style={[s.sectionTitle, { color: headerText }]}>{title}</Text>
      </View>
      <View style={[s.tableHeaderRow, { backgroundColor: headerBg, opacity: 0.6 }]}>
        <Text style={[s.thCell, { width: 60 }]}>Código</Text>
        <Text style={[s.thCell, { flex: 1 }]}>Concepto</Text>
        <Text style={[s.thCell, { width: 72, textAlign: 'right' }]}>Monto</Text>
      </View>
      {entries.map((c, i) => (
        <View key={c.code} style={[s.tableRow, i % 2 === 1 ? s.tableRowAlt : {}]}>
          <Text style={s.tdCode}>{c.code}</Text>
          <Text style={s.tdName}>{c.name}</Text>
          <Text style={[s.tdAmount, { color: amountColor }]}>{fmt(c.amount)}</Text>
        </View>
      ))}
      <View
        style={[s.subtotalRow, { borderTopColor: subtotalBorder, backgroundColor: subtotalBg }]}
      >
        <Text style={[s.subtotalLabel, { color: subtotalColor }]}>Subtotal {title}</Text>
        <Text style={[s.subtotalValue, { color: subtotalColor }]}>{fmt(sum(entries))}</Text>
      </View>
    </View>
  )
}

// ─── Document ─────────────────────────────────────────────────────────────────

export function StubPdf({
  payroll,
  employee,
  line,
}: {
  payroll: StubPayroll
  employee: StubEmployee
  line: StubLine
}) {
  const concepts = line.concepts as StubConceptEntry[]
  const asignaciones = concepts.filter((c) => c.type === 'income')
  const deducciones = concepts.filter((c) => c.type === 'deduction')
  const patronales = concepts.filter((c) => c.type === 'patronal')
  const generatedAt = new Date().toLocaleString('es-PA', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
  const employeeName = `${employee.firstName} ${employee.lastName}`

  return (
    <Document
      title={`Comprobante — ${employeeName}`}
      author="PayrollSoft"
      subject="Comprobante de pago"
    >
      <Page size="LETTER" style={s.page}>
        {/* ── Header ── */}
        <View style={s.headerBar}>
          <View>
            <Text style={s.appName}>PayrollSoft</Text>
            <Text style={s.docTitle}>Comprobante de Pago</Text>
          </View>
          <View style={s.payrollBlock}>
            <Text style={s.payrollName}>{payroll.name}</Text>
            <View style={s.metaLine}>
              <Text style={s.metaLabel}>Tipo:</Text>
              <Text style={s.metaValue}>{TYPE_LABEL[payroll.type] ?? payroll.type}</Text>
              <Text style={s.metaLabel}>·</Text>
              <Text style={s.metaValue}>{FREQ_LABEL[payroll.frequency] ?? payroll.frequency}</Text>
            </View>
            <View style={s.metaLine}>
              <Text style={s.metaLabel}>Período:</Text>
              <Text style={s.metaValue}>
                {payroll.periodStart} — {payroll.periodEnd}
              </Text>
            </View>
            {payroll.paymentDate && (
              <View style={s.metaLine}>
                <Text style={s.metaLabel}>Fecha de pago:</Text>
                <Text style={s.metaValue}>{payroll.paymentDate}</Text>
              </View>
            )}
          </View>
        </View>
        <View style={s.dividerHeavy} />

        {/* ── Employee info ── */}
        <View style={s.empBox}>
          <View style={s.empGroup}>
            <View style={s.empField}>
              <Text style={s.empLabel}>Empleado:</Text>
              <Text style={s.empValue}>{employeeName}</Text>
            </View>
            <View style={s.empField}>
              <Text style={s.empLabel}>Código:</Text>
              <Text style={s.empValueNormal}>{employee.code}</Text>
            </View>
          </View>
          <View style={s.empGroup}>
            {employee.department && (
              <View style={s.empField}>
                <Text style={s.empLabel}>Departamento:</Text>
                <Text style={s.empValueNormal}>{employee.department}</Text>
              </View>
            )}
            {employee.position && (
              <View style={s.empField}>
                <Text style={s.empLabel}>Puesto:</Text>
                <Text style={s.empValueNormal}>{employee.position}</Text>
              </View>
            )}
          </View>
        </View>

        {/* ── Totals ── */}
        <View style={s.totalsRow}>
          <View style={s.totalCard}>
            <Text style={s.totalLabel}>Total Bruto</Text>
            <Text style={[s.totalValue, { color: C.black }]}>{fmt(line.grossAmount)}</Text>
          </View>
          <View style={s.totalCard}>
            <Text style={s.totalLabel}>Deducciones</Text>
            <Text style={[s.totalValue, { color: C.red600 }]}>{fmt(line.deductions)}</Text>
          </View>
          <View style={[s.totalCard, { backgroundColor: C.emerald50, borderColor: C.emerald700 }]}>
            <Text style={s.totalLabel}>Neto a Pagar</Text>
            <Text style={[s.totalValue, { color: C.emerald700 }]}>{fmt(line.netAmount)}</Text>
          </View>
        </View>

        {/* ── Concept tables ── */}
        <ConceptSection
          title="Asignaciones"
          entries={asignaciones}
          headerBg={C.blue50}
          headerText={C.blue800}
          subtotalColor={C.blue700}
          amountColor={C.black}
          subtotalBg={C.blue50}
          subtotalBorder={C.blue100}
        />
        <ConceptSection
          title="Deducciones"
          entries={deducciones}
          headerBg={C.red50}
          headerText={C.red700}
          subtotalColor={C.red700}
          amountColor={C.red600}
          subtotalBg={C.red50}
          subtotalBorder={C.red100}
        />
        <ConceptSection
          title="Patronales"
          entries={patronales}
          headerBg={C.amber50}
          headerText={C.amber700}
          subtotalColor={C.amber700}
          amountColor={C.amber700}
          subtotalBg={C.amber50}
          subtotalBorder={C.amber100}
        />

        {/* ── Signatures ── */}
        <View style={s.sigSection}>
          <View style={s.sigBlock}>
            <View style={s.sigLine}>
              <Text style={s.sigLabel}>Firma del Empleado</Text>
            </View>
          </View>
          <View style={s.sigBlock}>
            <View style={s.sigLine}>
              <Text style={s.sigLabel}>Firma del Empleador</Text>
            </View>
          </View>
        </View>

        {/* ── Footer ── */}
        <View style={s.footer} fixed>
          <Text style={s.footerText}>PayrollSoft — Comprobante de Pago</Text>
          <Text style={s.footerText}>Generado: {generatedAt}</Text>
        </View>
      </Page>
    </Document>
  )
}
