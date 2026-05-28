import { Document, Font, Page, StyleSheet, Text, View } from '@react-pdf/renderer'

// ─── Types ────────────────────────────────────────────────────────────────────

export type SiacapEmployee = {
  code: string
  idNumber: string | null
  socialSecurityNumber: string | null
  salary: number
  firstName: string
  lastName: string
  paymentDate: string | null
}

type SiacapPdfProps = {
  payroll: { name: string; periodStart: string; periodEnd: string }
  company: { companyName: string | null; ruc: string | null } | null
  employees: SiacapEmployee[]
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
    paddingTop: 24,
    paddingBottom: 36,
    paddingHorizontal: 20,
  },

  // ── Header ──
  header: {
    marginBottom: 8,
  },
  companyName: {
    fontSize: 14,
    fontFamily: 'Helvetica-Bold',
    color: C.navy,
    marginBottom: 2,
  },
  reportTitle: {
    fontSize: 10,
    fontFamily: 'Helvetica-Bold',
    color: C.black,
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  periodLine: {
    fontSize: 8,
    color: C.gray700,
  },
  divider: {
    borderBottomWidth: 1,
    borderBottomColor: C.gray300,
    marginBottom: 6,
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
  },
  tr: {
    flexDirection: 'row',
    paddingVertical: 3,
    paddingHorizontal: 2,
    borderBottomWidth: 0.5,
    borderBottomColor: C.gray200,
  },
  trAlt: { backgroundColor: C.gray50 },
  td: { fontSize: 6.5, paddingHorizontal: 1 },

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

  // Column widths — 14 columns totalling 100%
  colNumEmpleado: { width: '6%' },
  colCedula: { width: '7%' },
  colSeguroSocial: { width: '7%' },
  colSalario: { width: '8%', textAlign: 'right' },
  colDos: { width: '7%', textAlign: 'right' },
  colTreinta: { width: '7%', textAlign: 'right' },
  colRecargoUno: { width: '6%', textAlign: 'right' },
  colRecargoDiez: { width: '6%', textAlign: 'right' },
  colTotales: { width: '8%', textAlign: 'right' },
  colNombre: { width: '10%' },
  colApellido: { width: '10%' },
  colPatronal: { width: '7%' },
  colFechaMes: { width: '7%' },
  colObservaciones: { width: '14%' },

  // ── Footer ──
  footer: {
    position: 'absolute',
    bottom: 14,
    left: 20,
    right: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
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

// ─── Document ─────────────────────────────────────────────────────────────────

export function SiacapPdf({ payroll, company, employees }: SiacapPdfProps) {
  const companyName = company?.companyName ?? 'Empresa'
  const ruc = company?.ruc ?? ''

  const rows = employees.map((emp) => {
    const dos = emp.salary * 0.02
    const treinta = dos * 0.3
    const recargoUno = 0
    const recargoDiez = 0
    const total = dos + treinta
    return { emp, dos, treinta, recargoUno, recargoDiez, total }
  })

  const totals = rows.reduce(
    (acc, r) => {
      acc.salary += r.emp.salary
      acc.dos += r.dos
      acc.treinta += r.treinta
      acc.recargoUno += r.recargoUno
      acc.recargoDiez += r.recargoDiez
      acc.total += r.total
      return acc
    },
    { salary: 0, dos: 0, treinta: 0, recargoUno: 0, recargoDiez: 0, total: 0 }
  )

  const periodLine = `PLANILLA CORRESPONDIENTE AL PERIODO DEL ${formatDateISO(payroll.periodStart)} AL ${formatDateISO(payroll.periodEnd)}`

  return (
    <Document title="SIACAP - APORTES MENSUALES" author="PayrollSoft" subject={payroll.name}>
      <Page size="A4" style={s.page} orientation="landscape" wrap>
        {/* ── Header (repeats on every page) ── */}
        <View style={s.header} fixed>
          <Text style={s.companyName}>{companyName}</Text>
          <Text style={s.reportTitle}>SIACAP - APORTES MENSUALES</Text>
          <Text style={s.periodLine}>{periodLine}</Text>
        </View>

        <View style={s.divider} fixed />

        {/* ── Table ── */}
        <View style={s.table}>
          {/* Header row (repeats every page) */}
          <View style={s.tableHeader} fixed>
            <Text style={[s.th, s.colNumEmpleado]}>Num Empleado</Text>
            <Text style={[s.th, s.colCedula]}>Cedula</Text>
            <Text style={[s.th, s.colSeguroSocial]}>Seguro Social</Text>
            <Text style={[s.th, s.colSalario]}>Salario</Text>
            <Text style={[s.th, s.colDos]}>Dos%</Text>
            <Text style={[s.th, s.colTreinta]}>Treinta%</Text>
            <Text style={[s.th, s.colRecargoUno]}>Recargo 1%</Text>
            <Text style={[s.th, s.colRecargoDiez]}>Recargo 10%</Text>
            <Text style={[s.th, s.colTotales]}>Totales</Text>
            <Text style={[s.th, s.colNombre]}>Nombre</Text>
            <Text style={[s.th, s.colApellido]}>Apellido</Text>
            <Text style={[s.th, s.colPatronal]}>#Patronal</Text>
            <Text style={[s.th, s.colFechaMes]}>Fecha Del Mes</Text>
            <Text style={[s.th, s.colObservaciones]}>Observaciones</Text>
          </View>

          {/* Body rows */}
          {rows.map((r, i) => (
            <View key={r.emp.code} style={[s.tr, i % 2 === 1 ? s.trAlt : {}]} wrap={false}>
              <Text style={[s.td, s.colNumEmpleado]}>{r.emp.code}</Text>
              <Text style={[s.td, s.colCedula]}>{r.emp.idNumber ?? ''}</Text>
              <Text style={[s.td, s.colSeguroSocial]}>{r.emp.socialSecurityNumber ?? ''}</Text>
              <Text style={[s.td, s.colSalario]}>{fmt(r.emp.salary)}</Text>
              <Text style={[s.td, s.colDos]}>{fmt(r.dos)}</Text>
              <Text style={[s.td, s.colTreinta]}>{fmt(r.treinta)}</Text>
              <Text style={[s.td, s.colRecargoUno]}>{fmt(r.recargoUno)}</Text>
              <Text style={[s.td, s.colRecargoDiez]}>{fmt(r.recargoDiez)}</Text>
              <Text style={[s.td, s.colTotales, { fontFamily: 'Helvetica-Bold' }]}>
                {fmt(r.total)}
              </Text>
              <Text style={[s.td, s.colNombre]}>{r.emp.firstName}</Text>
              <Text style={[s.td, s.colApellido]}>{r.emp.lastName}</Text>
              <Text style={[s.td, s.colPatronal]}>{ruc}</Text>
              <Text style={[s.td, s.colFechaMes]}>
                {r.emp.paymentDate ? formatDateISO(r.emp.paymentDate) : ''}
              </Text>
              <Text style={[s.td, s.colObservaciones]}>Afiliado Recurrente</Text>
            </View>
          ))}

          {/* Totals row */}
          <View style={s.totalsRow} wrap={false}>
            <Text style={[s.tdTotal, s.colNumEmpleado]}>TOTALES</Text>
            <Text style={[s.tdTotal, s.colCedula]}>{employees.length} emp.</Text>
            <Text style={[s.tdTotal, s.colSeguroSocial]} />
            <Text style={[s.tdTotal, s.colSalario]}>{fmt(totals.salary)}</Text>
            <Text style={[s.tdTotal, s.colDos]}>{fmt(totals.dos)}</Text>
            <Text style={[s.tdTotal, s.colTreinta]}>{fmt(totals.treinta)}</Text>
            <Text style={[s.tdTotal, s.colRecargoUno]}>{fmt(totals.recargoUno)}</Text>
            <Text style={[s.tdTotal, s.colRecargoDiez]}>{fmt(totals.recargoDiez)}</Text>
            <Text style={[s.tdTotal, s.colTotales]}>{fmt(totals.total)}</Text>
            <Text style={[s.tdTotal, s.colNombre]} />
            <Text style={[s.tdTotal, s.colApellido]} />
            <Text style={[s.tdTotal, s.colPatronal]} />
            <Text style={[s.tdTotal, s.colFechaMes]} />
            <Text style={[s.tdTotal, s.colObservaciones]} />
          </View>
        </View>

        {/* ── Footer ── */}
        <View style={s.footer} fixed>
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
