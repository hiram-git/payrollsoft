import { Document, Font, Page, StyleSheet, Text, View } from '@react-pdf/renderer'

// ─── Types ────────────────────────────────────────────────────────────────────

export type RecapitulacionGroup = {
  partida: { code: string; name: string }
  buckets: {
    sueldoQuinc: number
    descLic: number
    devengado: number
    siacap: number
    se: number
    isr: number
    ss: number
    otrasDeduciones: number
    totalDescuentos: number
    neto: number
  }
}

type RecapitulacionTotals = RecapitulacionGroup['buckets']

type RecapitulacionProps = {
  payroll: {
    name: string
    type: string
    frequency: string
    periodStart: string
    periodEnd: string
    paymentDate: string | null
  }
  company: { companyName: string | null } | null
  groups: RecapitulacionGroup[]
  totals: RecapitulacionTotals
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
    fontSize: 8,
    color: C.black,
    paddingTop: 28,
    paddingBottom: 40,
    paddingHorizontal: 24,
  },

  // ── Header ──
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 2,
  },
  headerLeft: {
    width: '20%',
  },
  headerCenter: {
    width: '60%',
    alignItems: 'center',
  },
  headerRight: {
    width: '20%',
    alignItems: 'flex-end',
  },
  companyName: {
    fontSize: 14,
    fontFamily: 'Helvetica-Bold',
    color: C.navy,
    textAlign: 'center',
    marginBottom: 4,
  },
  reportTitle: {
    fontSize: 14,
    fontFamily: 'Helvetica-Bold',
    color: C.black,
    textAlign: 'center',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  subtitle: {
    fontSize: 9,
    color: C.gray700,
    textAlign: 'center',
    marginBottom: 2,
  },
  dateText: {
    fontSize: 8,
    color: C.gray700,
  },
  pageNumberHeader: {
    fontSize: 8,
    color: C.gray700,
  },

  divider: {
    borderBottomWidth: 1,
    borderBottomColor: C.gray300,
    marginTop: 6,
    marginBottom: 10,
  },

  // ── Table ──
  table: { flexDirection: 'column' },
  tableHeader: {
    flexDirection: 'row',
    borderTopWidth: 1.5,
    borderTopColor: C.navy,
    borderBottomWidth: 1.5,
    borderBottomColor: C.navy,
    paddingVertical: 5,
    paddingHorizontal: 4,
    backgroundColor: C.white,
  },
  th: {
    fontSize: 6.5,
    fontFamily: 'Helvetica-Bold',
    color: C.navy,
    textTransform: 'uppercase',
    paddingHorizontal: 1,
  },
  tr: {
    flexDirection: 'row',
    paddingVertical: 4,
    paddingHorizontal: 4,
    borderBottomWidth: 0.5,
    borderBottomColor: C.gray200,
  },
  trAlt: { backgroundColor: C.gray50 },
  td: { fontSize: 7.5, paddingHorizontal: 1 },
  tdNumber: {
    fontSize: 7,
    fontFamily: 'Helvetica',
    color: C.black,
    paddingHorizontal: 1,
  },

  // ── Column widths ──
  // 11 columns: partida (18%) + 10 numeric (8.2% each = 82%)
  colPartida: { width: '18%' },
  colNum: { width: '8.2%', textAlign: 'right' },

  // ── Totals row ──
  totalsRow: {
    flexDirection: 'row',
    paddingVertical: 6,
    paddingHorizontal: 4,
    borderTopWidth: 1.5,
    borderTopColor: C.navy,
    borderBottomWidth: 1.5,
    borderBottomColor: C.navy,
    marginTop: 2,
  },
  tdTotal: {
    fontSize: 7.5,
    fontFamily: 'Helvetica-Bold',
    paddingHorizontal: 1,
  },

  // ── Footer ──
  footer: {
    position: 'absolute',
    bottom: 16,
    left: 24,
    right: 24,
    flexDirection: 'row',
    justifyContent: 'center',
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

function formatDateDMY(iso: string): string {
  const [y, m, d] = iso.split('-')
  if (!y || !m || !d) return iso
  return `${d}/${m}/${y}`
}

const TYPE_LABEL: Record<string, string> = {
  regular: 'REGULAR',
  thirteenth: 'XIII MES',
  special: 'ESPECIAL',
}

const FREQ_LABEL: Record<string, string> = {
  biweekly: 'QUINCENAL',
  monthly: 'MENSUAL',
  weekly: 'SEMANAL',
}

// ─── Document ─────────────────────────────────────────────────────────────────

export function RecapitulacionPdf({ payroll, company, groups, totals }: RecapitulacionProps) {
  const companyName = company?.companyName ?? 'Empresa'
  const typeLabel = TYPE_LABEL[payroll.type] ?? payroll.type.toUpperCase()
  const freqLabel = FREQ_LABEL[payroll.frequency] ?? payroll.frequency.toUpperCase()
  const periodLine = `Período: ${formatDateDMY(payroll.periodStart)} al ${formatDateDMY(payroll.periodEnd)} — ${typeLabel} ${freqLabel}`
  const today = formatDateDMY(new Date().toISOString().slice(0, 10))

  return (
    <Document
      title="RECAPITULACION DE LA PLANILLA DEL PERIODO"
      author="PayrollSoft"
      subject={payroll.name}
    >
      <Page size="A4" style={s.page} orientation="landscape" wrap>
        {/* ── Header (repeats on every page) ── */}
        <View fixed>
          <View style={s.headerRow}>
            <View style={s.headerLeft}>
              <Text style={s.dateText}>Fecha {today}</Text>
            </View>
            <View style={s.headerCenter}>
              <Text style={s.companyName}>{companyName}</Text>
            </View>
            <View style={s.headerRight}>
              <Text
                style={s.pageNumberHeader}
                render={({ pageNumber, totalPages }) => `Pág. ${pageNumber} / ${totalPages}`}
              />
            </View>
          </View>
          <Text style={s.reportTitle}>RECAPITULACION DE LA PLANILLA DEL PERIODO</Text>
          <Text style={s.subtitle}>{periodLine}</Text>
          <View style={s.divider} />
        </View>

        {/* ── Table ── */}
        <View style={s.table}>
          {/* Column headers (repeat on every page) */}
          <View style={s.tableHeader} fixed>
            <Text style={[s.th, s.colPartida]}>Partidas</Text>
            <Text style={[s.th, s.colNum]}>Sueldo Quinc.</Text>
            <Text style={[s.th, s.colNum]}>Total Desc Lic</Text>
            <Text style={[s.th, s.colNum]}>Total Devengado</Text>
            <Text style={[s.th, s.colNum]}>Fondo Comp</Text>
            <Text style={[s.th, s.colNum]}>Seguro Educ</Text>
            <Text style={[s.th, s.colNum]}>Impuesto S/Renta</Text>
            <Text style={[s.th, s.colNum]}>Seguro Social</Text>
            <Text style={[s.th, s.colNum]}>Otros Descuentos</Text>
            <Text style={[s.th, s.colNum]}>Total Descuentos</Text>
            <Text style={[s.th, s.colNum]}>Sueldo Neto</Text>
          </View>

          {/* Body rows */}
          {groups.map((g, i) => (
            <View
              key={`${g.partida.code}-${i}`}
              style={[s.tr, i % 2 === 1 ? s.trAlt : {}]}
              wrap={false}
            >
              <Text style={[s.td, s.colPartida]}>
                {i + 1}. {g.partida.code} — {g.partida.name}
              </Text>
              <Text style={[s.tdNumber, s.colNum]}>{fmt(g.buckets.sueldoQuinc)}</Text>
              <Text style={[s.tdNumber, s.colNum]}>{fmt(g.buckets.descLic)}</Text>
              <Text style={[s.tdNumber, s.colNum]}>{fmt(g.buckets.devengado)}</Text>
              <Text style={[s.tdNumber, s.colNum]}>{fmt(g.buckets.siacap)}</Text>
              <Text style={[s.tdNumber, s.colNum]}>{fmt(g.buckets.se)}</Text>
              <Text style={[s.tdNumber, s.colNum]}>{fmt(g.buckets.isr)}</Text>
              <Text style={[s.tdNumber, s.colNum]}>{fmt(g.buckets.ss)}</Text>
              <Text style={[s.tdNumber, s.colNum]}>{fmt(g.buckets.otrasDeduciones)}</Text>
              <Text style={[s.tdNumber, s.colNum]}>{fmt(g.buckets.totalDescuentos)}</Text>
              <Text style={[s.tdNumber, s.colNum, { fontFamily: 'Helvetica-Bold' }]}>
                {fmt(g.buckets.neto)}
              </Text>
            </View>
          ))}

          {/* Totals row */}
          <View style={s.totalsRow} wrap={false}>
            <Text style={[s.tdTotal, s.colPartida]}>TOTALES</Text>
            <Text style={[s.tdTotal, s.colNum]}>{fmt(totals.sueldoQuinc)}</Text>
            <Text style={[s.tdTotal, s.colNum]}>{fmt(totals.descLic)}</Text>
            <Text style={[s.tdTotal, s.colNum]}>{fmt(totals.devengado)}</Text>
            <Text style={[s.tdTotal, s.colNum]}>{fmt(totals.siacap)}</Text>
            <Text style={[s.tdTotal, s.colNum]}>{fmt(totals.se)}</Text>
            <Text style={[s.tdTotal, s.colNum]}>{fmt(totals.isr)}</Text>
            <Text style={[s.tdTotal, s.colNum]}>{fmt(totals.ss)}</Text>
            <Text style={[s.tdTotal, s.colNum]}>{fmt(totals.otrasDeduciones)}</Text>
            <Text style={[s.tdTotal, s.colNum]}>{fmt(totals.totalDescuentos)}</Text>
            <Text style={[s.tdTotal, s.colNum]}>{fmt(totals.neto)}</Text>
          </View>
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
