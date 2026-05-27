import { Document, Font, Page, StyleSheet, Text, View } from '@react-pdf/renderer'

// ─── Types ────────────────────────────────────────────────────────────────────

export type TransferenciasGroup = {
  partida: { code: string; name: string }
  buckets: {
    devengado: number
    ss: number
    se: number
    siacap: number
    isr: number
    otrasDeduciones: number
    neto: number
    ssPatrono: number
    sePatrono: number
    rpPatrono: number
    siacapPatrono: number
    totalPatrono: number
  }
}

type TransferenciasTotals = TransferenciasGroup['buckets']

type TransferenciasProps = {
  payroll: {
    name: string
    type: string
    frequency: string
    periodStart: string
    periodEnd: string
    paymentDate: string | null
  }
  company: { companyName: string | null } | null
  groups: TransferenciasGroup[]
  totals: TransferenciasTotals
}

// ─── Fonts ────────────────────────────────────────────────────────────────────

Font.registerHyphenationCallback((word) => [word])

// ─── Palette ──────────────────────────────────────────────────────────────────

const C = {
  black: '#111827',
  gray700: '#374151',
  gray500: '#6b7280',
  gray300: '#d1d5db',
  gray200: '#e5e7eb',
  gray100: '#f3f4f6',
  gray50: '#f9fafb',
  white: '#ffffff',
  navy: '#0f172a',
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  page: {
    fontFamily: 'Helvetica',
    fontSize: 7,
    color: C.black,
    paddingTop: 20,
    paddingBottom: 40,
    paddingHorizontal: 20,
  },

  // ── Header ──
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 2,
  },
  companyName: {
    fontSize: 10,
    fontFamily: 'Helvetica-Bold',
    color: C.navy,
  },
  frequencyText: {
    fontSize: 8,
    color: C.gray700,
  },
  reportTitle: {
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
    color: C.black,
    letterSpacing: 0.3,
    marginBottom: 1,
  },
  subTitle: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    color: C.black,
    marginBottom: 6,
  },
  dateRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 2,
  },
  dateBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  dateLabel: {
    fontSize: 6.5,
    fontFamily: 'Helvetica-Bold',
    color: C.gray700,
  },
  dateValue: {
    fontSize: 6.5,
    color: C.black,
    borderWidth: 0.5,
    borderColor: C.gray300,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  planillaLabel: {
    fontSize: 7,
    color: C.gray700,
  },

  // ── Table ──
  table: { flexDirection: 'column' },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: C.navy,
    paddingVertical: 4,
    paddingHorizontal: 2,
  },
  th: {
    fontSize: 5.5,
    fontFamily: 'Helvetica-Bold',
    color: C.white,
    textTransform: 'uppercase',
    paddingHorizontal: 1,
    textAlign: 'center',
  },
  tr: {
    flexDirection: 'row',
    paddingVertical: 3,
    paddingHorizontal: 2,
    borderBottomWidth: 0.5,
    borderBottomColor: C.gray200,
  },
  trAlt: { backgroundColor: C.gray50 },
  td: {
    fontSize: 6.5,
    paddingHorizontal: 1,
  },

  // Column widths — 13 columns in landscape A4
  colPartida: { width: '12%' },
  colDevengado: { width: '8%', textAlign: 'right' },
  colSS: { width: '7%', textAlign: 'right' },
  colSE: { width: '7%', textAlign: 'right' },
  colSiacap: { width: '7%', textAlign: 'right' },
  colISR: { width: '7.5%', textAlign: 'right' },
  colOblig: { width: '7.5%', textAlign: 'right' },
  colNeto: { width: '8%', textAlign: 'right' },
  colSSP: { width: '7.5%', textAlign: 'right' },
  colSEP: { width: '7.5%', textAlign: 'right' },
  colRP: { width: '7.5%', textAlign: 'right' },
  colSiacapP: { width: '7.5%', textAlign: 'right' },
  colTotales: { width: '7.5%', textAlign: 'right' },

  // ── Totals row ──
  totalsRow: {
    flexDirection: 'row',
    paddingVertical: 5,
    paddingHorizontal: 2,
    backgroundColor: C.gray100,
    borderTopWidth: 1,
    borderTopColor: C.navy,
    marginTop: 2,
  },
  tdTotal: {
    fontSize: 7,
    fontFamily: 'Helvetica-Bold',
    paddingHorizontal: 1,
  },

  // ── Signatures ──
  signatureSection: {
    marginTop: 36,
    flexDirection: 'row',
    gap: 12,
  },
  signatureBlock: {
    flex: 1,
    alignItems: 'center',
  },
  signatureLine: {
    borderTopWidth: 1,
    borderTopColor: C.gray700,
    width: '90%',
    paddingTop: 4,
    alignItems: 'center',
  },
  signatureRole: {
    fontSize: 6.5,
    color: C.gray500,
    marginTop: 1,
    textAlign: 'center',
  },

  // ── Footer ──
  footer: {
    position: 'absolute',
    bottom: 14,
    left: 20,
    right: 20,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    borderTopWidth: 0.5,
    borderTopColor: C.gray300,
    paddingTop: 4,
  },
  footerText: { fontSize: 6.5, color: C.gray500 },
})

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(v: number) {
  return v.toLocaleString('es-PA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatDateISO(iso: string): string {
  const [y, m, d] = iso.split('-')
  if (!y || !m || !d) return iso
  return `${d}-${m}-${y}`
}

const TYPE_LABEL: Record<string, string> = {
  regular: 'REGULAR',
  thirteenth: 'XIII MES',
  special: 'ESPECIAL',
}

// ─── Document ─────────────────────────────────────────────────────────────────

export function TransferenciasPdf({ payroll, company, groups, totals }: TransferenciasProps) {
  const companyName = company?.companyName ?? 'Empresa'
  const typeLabel = TYPE_LABEL[payroll.type] ?? payroll.type.toUpperCase()

  return (
    <Document title={`Transferencias ${typeLabel}`} author="PayrollSoft" subject={payroll.name}>
      <Page size="A4" style={s.page} orientation="landscape" wrap>
        {/* ── Header (repeats on every page) ── */}
        <View fixed>
          <View style={s.headerRow}>
            <Text style={s.companyName}>{companyName}</Text>
            <Text style={s.frequencyText}>{payroll.frequency}</Text>
          </View>

          <View style={s.headerRow}>
            <Text style={s.reportTitle}>IMPUTACION A LAS PARTIDAS DEL PRESUPUESTO</Text>
            <View style={s.dateRow}>
              <View style={s.dateBox}>
                <Text style={s.dateLabel}>DESDE:</Text>
                <Text style={s.dateValue}>{formatDateISO(payroll.periodStart)}</Text>
              </View>
              <View style={s.dateBox}>
                <Text style={s.dateLabel}>HASTA:</Text>
                <Text style={s.dateValue}>{formatDateISO(payroll.periodEnd)}</Text>
              </View>
              {payroll.paymentDate && (
                <View style={s.dateBox}>
                  <Text style={s.dateLabel}>PAGO:</Text>
                  <Text style={s.dateValue}>{formatDateISO(payroll.paymentDate)}</Text>
                </View>
              )}
            </View>
          </View>

          <View style={s.headerRow}>
            <Text style={s.subTitle}>TRANSFERENCIAS {typeLabel}</Text>
            <Text style={s.planillaLabel}>Planilla: {payroll.name}</Text>
          </View>
        </View>

        {/* ── Table ── */}
        <View style={s.table}>
          <View style={s.tableHeader} fixed>
            <Text style={[s.th, s.colPartida, { textAlign: 'left' }]}>Partida</Text>
            <Text style={[s.th, s.colDevengado]}>T. Devengado</Text>
            <Text style={[s.th, s.colSS]}>S. Social Emp</Text>
            <Text style={[s.th, s.colSE]}>S. Educ Emp</Text>
            <Text style={[s.th, s.colSiacap]}>Siacap Emp</Text>
            <Text style={[s.th, s.colISR]}>Impuesto Renta</Text>
            <Text style={[s.th, s.colOblig]}>Obligaciones</Text>
            <Text style={[s.th, s.colNeto]}>Total Neto</Text>
            <Text style={[s.th, s.colSSP]}>S.S. Patrono</Text>
            <Text style={[s.th, s.colSEP]}>S.E. Patrono</Text>
            <Text style={[s.th, s.colRP]}>R. Profesional</Text>
            <Text style={[s.th, s.colSiacapP]}>Siacap Patrono</Text>
            <Text style={[s.th, s.colTotales]}>Totales</Text>
          </View>

          {groups.map((g, i) => (
            <View key={g.partida.code} style={[s.tr, i % 2 === 1 ? s.trAlt : {}]} wrap={false}>
              <Text style={[s.td, s.colPartida]}>
                {g.partida.code} - {g.partida.name}
              </Text>
              <Text style={[s.td, s.colDevengado]}>{fmt(g.buckets.devengado)}</Text>
              <Text style={[s.td, s.colSS]}>{fmt(g.buckets.ss)}</Text>
              <Text style={[s.td, s.colSE]}>{fmt(g.buckets.se)}</Text>
              <Text style={[s.td, s.colSiacap]}>{fmt(g.buckets.siacap)}</Text>
              <Text style={[s.td, s.colISR]}>{fmt(g.buckets.isr)}</Text>
              <Text style={[s.td, s.colOblig]}>{fmt(g.buckets.otrasDeduciones)}</Text>
              <Text style={[s.td, s.colNeto]}>{fmt(g.buckets.neto)}</Text>
              <Text style={[s.td, s.colSSP]}>{fmt(g.buckets.ssPatrono)}</Text>
              <Text style={[s.td, s.colSEP]}>{fmt(g.buckets.sePatrono)}</Text>
              <Text style={[s.td, s.colRP]}>{fmt(g.buckets.rpPatrono)}</Text>
              <Text style={[s.td, s.colSiacapP]}>{fmt(g.buckets.siacapPatrono)}</Text>
              <Text style={[s.td, s.colTotales, { fontFamily: 'Helvetica-Bold' }]}>
                {fmt(g.buckets.totalPatrono)}
              </Text>
            </View>
          ))}

          {/* Totals row */}
          <View style={s.totalsRow} wrap={false}>
            <Text style={[s.tdTotal, s.colPartida]}>TOTALES</Text>
            <Text style={[s.tdTotal, s.colDevengado]}>{fmt(totals.devengado)}</Text>
            <Text style={[s.tdTotal, s.colSS]}>{fmt(totals.ss)}</Text>
            <Text style={[s.tdTotal, s.colSE]}>{fmt(totals.se)}</Text>
            <Text style={[s.tdTotal, s.colSiacap]}>{fmt(totals.siacap)}</Text>
            <Text style={[s.tdTotal, s.colISR]}>{fmt(totals.isr)}</Text>
            <Text style={[s.tdTotal, s.colOblig]}>{fmt(totals.otrasDeduciones)}</Text>
            <Text style={[s.tdTotal, s.colNeto]}>{fmt(totals.neto)}</Text>
            <Text style={[s.tdTotal, s.colSSP]}>{fmt(totals.ssPatrono)}</Text>
            <Text style={[s.tdTotal, s.colSEP]}>{fmt(totals.sePatrono)}</Text>
            <Text style={[s.tdTotal, s.colRP]}>{fmt(totals.rpPatrono)}</Text>
            <Text style={[s.tdTotal, s.colSiacapP]}>{fmt(totals.siacapPatrono)}</Text>
            <Text style={[s.tdTotal, s.colTotales]}>{fmt(totals.totalPatrono)}</Text>
          </View>
        </View>

        {/* ── Signatures ── */}
        <View style={s.signatureSection} wrap={false}>
          {[
            'Confeccionado por',
            'Sub Gerente de Operaciones',
            'Dir. De Rec. Humanos',
            'Jefe de Fiscalización',
            'Jefe de Presupuesto',
          ].map((role) => (
            <View key={role} style={s.signatureBlock}>
              <View style={s.signatureLine}>
                <Text style={s.signatureRole}>{role}</Text>
              </View>
            </View>
          ))}
        </View>

        {/* ── Footer ── */}
        <View style={s.footer} fixed>
          <Text
            style={s.footerText}
            render={({ pageNumber, totalPages }) => `Página ${pageNumber} de ${totalPages}`}
          />
        </View>
      </Page>
    </Document>
  )
}
