import { Document, Font, Page, StyleSheet, Text, View } from '@react-pdf/renderer'

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
    code: string
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

// ─── Fonts ────────────────────────────────────────────────────────────────────

Font.registerHyphenationCallback((word) => [word])

// ─── Styles ───────────────────────────────────────────────────────────────────

const C = {
  black: '#111827',
  gray700: '#374151',
  gray500: '#6b7280',
  gray400: '#9ca3af',
  gray200: '#e5e7eb',
  gray100: '#f3f4f6',
  gray50: '#f9fafb',
  blue600: '#2563eb',
  blue50: '#eff6ff',
  emerald700: '#047857',
  emerald50: '#ecfdf5',
  red600: '#dc2626',
  red50: '#fef2f2',
  white: '#ffffff',
}

const s = StyleSheet.create({
  page: {
    fontFamily: 'Helvetica',
    fontSize: 8,
    color: C.black,
    paddingTop: 36,
    paddingBottom: 48,
    paddingHorizontal: 40,
  },
  // Header
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 20,
  },
  headerLeft: { flex: 1 },
  appName: { fontSize: 14, fontFamily: 'Helvetica-Bold', color: C.black, marginBottom: 2 },
  payrollName: { fontSize: 11, fontFamily: 'Helvetica-Bold', color: C.black, marginBottom: 4 },
  metaRow: { flexDirection: 'row', gap: 12, marginBottom: 2 },
  metaLabel: { color: C.gray500, fontSize: 7.5 },
  metaValue: { color: C.gray700, fontSize: 7.5 },
  statusPill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
    alignSelf: 'flex-start',
  },
  statusText: { fontSize: 7, fontFamily: 'Helvetica-Bold' },
  // Divider
  divider: { borderBottomWidth: 1, borderBottomColor: C.gray200, marginBottom: 14 },
  // Totals
  totalsRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  totalCard: {
    flex: 1,
    backgroundColor: C.gray50,
    borderRadius: 4,
    padding: 10,
    borderWidth: 1,
    borderColor: C.gray200,
  },
  totalLabel: { fontSize: 7, color: C.gray500, marginBottom: 3, textTransform: 'uppercase' },
  totalValue: { fontSize: 12, fontFamily: 'Helvetica-Bold' },
  // Table
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: C.gray100,
    borderRadius: 3,
    paddingVertical: 5,
    paddingHorizontal: 6,
    marginBottom: 2,
  },
  tableHeaderCell: {
    fontSize: 7,
    fontFamily: 'Helvetica-Bold',
    color: C.gray500,
    textTransform: 'uppercase',
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 5,
    paddingHorizontal: 6,
    borderBottomWidth: 1,
    borderBottomColor: C.gray100,
  },
  tableRowAlt: { backgroundColor: C.gray50 },
  cell: { fontSize: 7.5 },
  cellBold: { fontSize: 7.5, fontFamily: 'Helvetica-Bold' },
  cellMuted: { fontSize: 7, color: C.gray500, marginTop: 1 },
  // Col widths
  colEmployee: { flex: 3 },
  colDept: { flex: 2.5 },
  colAmount: { flex: 1.5, textAlign: 'right' },
  colNet: { flex: 1.5, textAlign: 'right' },
  // Concepts sub-row
  conceptsRow: {
    paddingHorizontal: 6,
    paddingBottom: 6,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
  },
  conceptPill: { paddingHorizontal: 5, paddingVertical: 2, borderRadius: 3, borderWidth: 1 },
  conceptText: { fontSize: 6.5 },
  // Footer
  footer: {
    position: 'absolute',
    bottom: 24,
    left: 40,
    right: 40,
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: C.gray200,
    paddingTop: 6,
  },
  footerText: { fontSize: 6.5, color: C.gray400 },
  // Section title
  sectionTitle: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    color: C.gray700,
    marginBottom: 6,
    textTransform: 'uppercase',
  },
})

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(v: string | number) {
  return Number(v).toLocaleString('es-PA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
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
const STATUS_LABEL: Record<string, string> = {
  created: 'Creada',
  generated: 'Generada',
  closed: 'Cerrada',
  processing: 'Procesando',
}
const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  created: { bg: C.gray100, text: C.gray500 },
  generated: { bg: C.blue50, text: C.blue600 },
  closed: { bg: C.emerald50, text: C.emerald700 },
  processing: { bg: '#fffbeb', text: '#b45309' },
}

// ─── Document ────────────────────────────────────────────────────────────────

export function PayrollPdf({
  payroll,
  lines,
}: {
  payroll: PdfPayroll
  lines: PdfPayrollLine[]
}) {
  const status = STATUS_COLORS[payroll.status] ?? { bg: C.gray100, text: C.gray500 }
  const generatedAt = new Date().toLocaleString('es-PA', {
    dateStyle: 'long',
    timeStyle: 'short',
  })

  return (
    <Document title={payroll.name} author="PayrollSoft" subject="Planilla">
      <Page size="LETTER" style={s.page} orientation="landscape">
        {/* ── Header ── */}
        <View style={s.header}>
          <View style={s.headerLeft}>
            <Text style={s.appName}>PayrollSoft</Text>
            <Text style={s.payrollName}>{payroll.name}</Text>
            <View style={s.metaRow}>
              <Text style={s.metaLabel}>Tipo:</Text>
              <Text style={s.metaValue}>{TYPE_LABEL[payroll.type] ?? payroll.type}</Text>
              <Text style={s.metaLabel}>Frecuencia:</Text>
              <Text style={s.metaValue}>{FREQ_LABEL[payroll.frequency] ?? payroll.frequency}</Text>
              <Text style={s.metaLabel}>Período:</Text>
              <Text style={s.metaValue}>
                {payroll.periodStart} — {payroll.periodEnd}
              </Text>
              {payroll.paymentDate && (
                <>
                  <Text style={s.metaLabel}>Fecha de pago:</Text>
                  <Text style={s.metaValue}>{payroll.paymentDate}</Text>
                </>
              )}
            </View>
          </View>
          <View style={[s.statusPill, { backgroundColor: status.bg }]}>
            <Text style={[s.statusText, { color: status.text }]}>
              {STATUS_LABEL[payroll.status] ?? payroll.status}
            </Text>
          </View>
        </View>

        <View style={s.divider} />

        {/* ── Totals ── */}
        <View style={s.totalsRow}>
          <View style={s.totalCard}>
            <Text style={s.totalLabel}>Total Bruto</Text>
            <Text style={[s.totalValue, { color: C.black }]}>{fmt(payroll.totalGross)}</Text>
          </View>
          <View style={s.totalCard}>
            <Text style={s.totalLabel}>Deducciones</Text>
            <Text style={[s.totalValue, { color: C.red600 }]}>{fmt(payroll.totalDeductions)}</Text>
          </View>
          <View style={[s.totalCard, { borderColor: C.emerald700, backgroundColor: C.emerald50 }]}>
            <Text style={s.totalLabel}>Neto a Pagar</Text>
            <Text style={[s.totalValue, { color: C.emerald700 }]}>{fmt(payroll.totalNet)}</Text>
          </View>
          <View style={[s.totalCard, { backgroundColor: C.white }]}>
            <Text style={s.totalLabel}>Empleados</Text>
            <Text style={[s.totalValue, { color: C.black }]}>{lines.length}</Text>
          </View>
        </View>

        {/* ── Employee table ── */}
        <Text style={s.sectionTitle}>Detalle por empleado</Text>

        {/* Table header */}
        <View style={s.tableHeader}>
          <Text style={[s.tableHeaderCell, s.colEmployee]}>Empleado</Text>
          <Text style={[s.tableHeaderCell, s.colDept]}>Depto / Puesto</Text>
          <Text style={[s.tableHeaderCell, s.colAmount]}>Bruto</Text>
          <Text style={[s.tableHeaderCell, s.colAmount]}>Deduc.</Text>
          <Text style={[s.tableHeaderCell, s.colNet]}>Neto</Text>
        </View>

        {/* Table rows */}
        {lines.map((l, i) => (
          <View key={l.employee.code} wrap={false}>
            <View style={[s.tableRow, i % 2 === 1 ? s.tableRowAlt : {}]}>
              <View style={s.colEmployee}>
                <Text style={s.cellBold}>
                  {l.employee.firstName} {l.employee.lastName}
                </Text>
                <Text style={s.cellMuted}>{l.employee.code}</Text>
              </View>
              <View style={s.colDept}>
                <Text style={s.cell}>{l.employee.department ?? '—'}</Text>
                {l.employee.position && <Text style={s.cellMuted}>{l.employee.position}</Text>}
              </View>
              <Text style={[s.cell, s.colAmount]}>{fmt(l.line.grossAmount)}</Text>
              <Text style={[s.cell, s.colAmount, { color: C.red600 }]}>
                {fmt(l.line.deductions)}
              </Text>
              <Text style={[s.cellBold, s.colNet, { color: C.emerald700 }]}>
                {fmt(l.line.netAmount)}
              </Text>
            </View>
            {/* Concept pills */}
            {l.line.concepts.filter((c) => c.amount !== 0).length > 0 && (
              <View style={[s.conceptsRow, i % 2 === 1 ? { backgroundColor: C.gray50 } : {}]}>
                {l.line.concepts
                  .filter((c) => c.amount !== 0)
                  .map((c) => (
                    <View
                      key={c.code}
                      style={[
                        s.conceptPill,
                        {
                          backgroundColor: c.type === 'income' ? C.blue50 : C.red50,
                          borderColor: c.type === 'income' ? '#bfdbfe' : '#fecaca',
                        },
                      ]}
                    >
                      <Text
                        style={[
                          s.conceptText,
                          { color: c.type === 'income' ? C.blue600 : C.red600 },
                        ]}
                      >
                        {c.code} · {c.name}: {fmt(c.amount)}
                      </Text>
                    </View>
                  ))}
              </View>
            )}
          </View>
        ))}

        {/* ── Footer ── */}
        <View style={s.footer} fixed>
          <Text style={s.footerText}>PayrollSoft — {payroll.name}</Text>
          <Text
            style={s.footerText}
            render={({ pageNumber, totalPages }) => `Página ${pageNumber} de ${totalPages}`}
          />
          <Text style={s.footerText}>Generado: {generatedAt}</Text>
        </View>
      </Page>
    </Document>
  )
}
