import { Document, Font, Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer'

// ─── Types ────────────────────────────────────────────────────────────────────

export type PdfPersonnelEmployee = {
  code: string
  firstName: string
  lastName: string
  idNumber: string | null
  department: string | null
  position: string | null
  hireDate: string | null
  baseSalary: string | null
  payFrequency: string | null
  isActive: boolean
}

export type PdfPersonnelCompany = {
  companyName: string | null
  logoEmpresa: string | null
}

export type PdfPersonnelGeneratedBy = {
  name: string | null
  email: string | null
}

// ─── Fonts ────────────────────────────────────────────────────────────────────

Font.registerHyphenationCallback((word) => [word])

// ─── Palette (mirrors payroll-pdf for brand consistency) ──────────────────────

const C = {
  black: '#111827',
  gray700: '#374151',
  gray500: '#6b7280',
  gray400: '#9ca3af',
  gray300: '#d1d5db',
  gray200: '#e5e7eb',
  gray100: '#f3f4f6',
  gray50: '#f9fafb',
  emerald700: '#047857',
  red600: '#dc2626',
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

  // Filter chip
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 3,
    backgroundColor: C.gray100,
    borderRadius: 3,
    marginBottom: 8,
  },
  filterLabel: { fontSize: 7.5, color: C.gray500, marginRight: 4 },
  filterValue: { fontSize: 8, fontFamily: 'Helvetica-Bold', color: C.navy },

  // Table
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

  // A4 landscape usable width ≈ 794pt after 24pt margins.
  // Eight columns sum to 100% (4+12+18+15+15+11+8+9 + 8 small paddings).
  colCode: { width: '7%' },
  colName: { width: '18%' },
  colCedula: { width: '10%' },
  colDept: { width: '17%' },
  colPosition: { width: '17%' },
  colHire: { width: '10%' },
  colFreq: { width: '8%' },
  colSalary: { width: '8%', textAlign: 'right' },
  colStatus: { width: '5%', textAlign: 'right' },

  // Status pill rendered as plain coloured text — no <View> per row
  // because each table row is a flex row of <Text> nodes.
  statusActive: { color: C.emerald700, fontFamily: 'Helvetica-Bold' },
  statusInactive: { color: C.red600, fontFamily: 'Helvetica-Bold' },

  // Totals row
  totalsRow: {
    flexDirection: 'row',
    paddingVertical: 6,
    paddingHorizontal: 4,
    backgroundColor: C.gray100,
    borderTopWidth: 1,
    borderTopColor: C.navy,
    marginTop: 2,
  },
  tdTotal: { fontSize: 8, fontFamily: 'Helvetica-Bold', paddingHorizontal: 2 },

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

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtMoney(v: string | null) {
  if (v === null || v === undefined) return '—'
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  return n.toLocaleString('es-PA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatDateISO(iso: string | null): string {
  if (!iso) return '—'
  const [y, m, d] = iso.slice(0, 10).split('-')
  if (!y || !m || !d) return iso
  return `${d}-${m}-${y}`
}

const FREQ_LABEL: Record<string, string> = {
  weekly: 'Semanal',
  biweekly: 'Quincenal',
  monthly: 'Mensual',
}

// ─── Document ─────────────────────────────────────────────────────────────────

export function PersonnelPdf({
  employees,
  company,
  payrollTypeName,
  generatedBy,
}: {
  employees: PdfPersonnelEmployee[]
  company: PdfPersonnelCompany | null
  payrollTypeName: string | null
  generatedBy?: PdfPersonnelGeneratedBy | null
}) {
  const generatedAt = new Date().toLocaleString('es-PA', {
    dateStyle: 'medium',
    timeStyle: 'medium',
  })
  const companyName = company?.companyName ?? 'Empresa'
  const logo = company?.logoEmpresa ?? null
  const reportTitle = 'LISTADO DE PERSONAL'
  const totalSalary = employees.reduce((acc, e) => acc + (Number(e.baseSalary) || 0), 0)
  const activeCount = employees.filter((e) => e.isActive).length

  return (
    <Document title={reportTitle} author="PayrollSoft" subject="Listado de personal">
      <Page size="A4" style={s.page} orientation="landscape" wrap>
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
            <Text style={s.periodLine}>Generado el {generatedAt}</Text>
          </View>
          <View style={s.headerSpacer} />
        </View>

        <View style={s.divider} fixed />

        {payrollTypeName && (
          <View style={s.filterChip}>
            <Text style={s.filterLabel}>Tipo de planilla:</Text>
            <Text style={s.filterValue}>{payrollTypeName}</Text>
          </View>
        )}

        <View style={s.table}>
          <View style={s.tableHeader} fixed>
            <Text style={[s.th, s.colCode]}>Código</Text>
            <Text style={[s.th, s.colName]}>Nombre</Text>
            <Text style={[s.th, s.colCedula]}>Cédula</Text>
            <Text style={[s.th, s.colDept]}>Departamento</Text>
            <Text style={[s.th, s.colPosition]}>Cargo</Text>
            <Text style={[s.th, s.colHire]}>F. Ingreso</Text>
            <Text style={[s.th, s.colFreq]}>Frec.</Text>
            <Text style={[s.th, s.colSalary]}>Salario</Text>
            <Text style={[s.th, s.colStatus]}>Estado</Text>
          </View>

          {employees.map((e, i) => {
            const fullName = `${e.firstName} ${e.lastName}`.trim()
            return (
              <View key={e.code} style={[s.tr, i % 2 === 1 ? s.trAlt : {}]} wrap={false}>
                <Text style={[s.td, s.colCode, s.tdMuted]}>{e.code}</Text>
                <Text style={[s.td, s.colName]}>{fullName}</Text>
                <Text style={[s.td, s.colCedula, s.tdMuted]}>{e.idNumber ?? '—'}</Text>
                <Text style={[s.td, s.colDept]}>{e.department ?? '—'}</Text>
                <Text style={[s.td, s.colPosition]}>{e.position ?? '—'}</Text>
                <Text style={[s.td, s.colHire, s.tdMuted]}>{formatDateISO(e.hireDate)}</Text>
                <Text style={[s.td, s.colFreq, s.tdMuted]}>
                  {FREQ_LABEL[e.payFrequency ?? ''] ?? e.payFrequency ?? '—'}
                </Text>
                <Text style={[s.td, s.colSalary]}>{fmtMoney(e.baseSalary)}</Text>
                <Text style={[s.td, s.colStatus, e.isActive ? s.statusActive : s.statusInactive]}>
                  {e.isActive ? 'ACT' : 'INA'}
                </Text>
              </View>
            )
          })}

          <View style={s.totalsRow} wrap={false}>
            <Text style={[s.tdTotal, s.colCode]}>TOTALES</Text>
            <Text style={[s.tdTotal, s.colName, s.tdMuted]}>
              {employees.length} {employees.length === 1 ? 'empleado' : 'empleados'}
            </Text>
            <Text style={[s.tdTotal, s.colCedula]} />
            <Text style={[s.tdTotal, s.colDept]} />
            <Text style={[s.tdTotal, s.colPosition]} />
            <Text style={[s.tdTotal, s.colHire]} />
            <Text style={[s.tdTotal, s.colFreq, s.tdMuted]}>{activeCount} act.</Text>
            <Text style={[s.tdTotal, s.colSalary]}>{fmtMoney(String(totalSalary))}</Text>
            <Text style={[s.tdTotal, s.colStatus]} />
          </View>
        </View>

        <View style={s.footer} fixed>
          <Text style={s.footerText}>
            Generado: {generatedAt}
            {generatedBy?.name ? ` · por ${generatedBy.name}` : ''}
            {generatedBy?.email ? ` (${generatedBy.email})` : ''}
          </Text>
          <Text style={s.footerText}>{companyName} — Listado de Personal</Text>
          <Text
            style={s.footerText}
            render={({ pageNumber, totalPages }) => `Página ${pageNumber} de ${totalPages}`}
          />
        </View>
      </Page>
    </Document>
  )
}
