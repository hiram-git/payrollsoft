import { Document, Font, Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer'

// ─── Types ────────────────────────────────────────────────────────────────────

export type MovementsPdfRow = {
  documentNumber: string
  documentDate: string
  employeeCode: string
  firstName: string
  lastName: string
  typeName: string
  subtypeName: string
  approvalStatus: string
  createdByName: string
}

export type MovementsPdfFilters = {
  year?: string | null
  from?: string | null
  to?: string | null
  typeName?: string | null
  subtypeName?: string | null
}

export type MovementsPdfGeneratedBy = {
  name: string | null
  email: string | null
}

type MovementsPdfProps = {
  company: { companyName: string | null; logoEmpresa: string | null } | null
  filters: MovementsPdfFilters
  rows: MovementsPdfRow[]
  generatedBy?: MovementsPdfGeneratedBy | null
}

// ─── Fonts ────────────────────────────────────────────────────────────────────

Font.registerHyphenationCallback((word) => [word])

// ─── Palette ──────────────────────────────────────────────────────────────────

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
  amber700: '#b45309',
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
    paddingHorizontal: 28,
  },

  // ── Header ──
  header: { marginBottom: 8 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2 },
  logoImg: { width: 36, height: 36, objectFit: 'contain' },
  companyName: { fontSize: 13, fontFamily: 'Helvetica-Bold', color: C.navy },
  reportTitle: {
    fontSize: 11,
    fontFamily: 'Helvetica-Bold',
    color: C.black,
    letterSpacing: 0.4,
    marginTop: 4,
  },
  divider: { borderBottomWidth: 1, borderBottomColor: C.gray300, marginVertical: 8 },

  // ── Filter chips ──
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: C.gray100,
    borderRadius: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  chipLabel: { fontSize: 6.5, color: C.gray500, textTransform: 'uppercase' },
  chipValue: { fontSize: 7.5, fontFamily: 'Helvetica-Bold', color: C.navy },

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

  // Column widths — A4 portrait usable ≈ 539pt after 28pt margins.
  colDoc: { width: '15%' },
  colDate: { width: '10%' },
  colEmployee: { width: '24%' },
  colType: { width: '16%' },
  colSubtype: { width: '17%' },
  colStatus: { width: '9%' },
  colUser: { width: '9%' },

  statusApproved: { color: C.emerald700, fontFamily: 'Helvetica-Bold' },
  statusPending: { color: C.amber700, fontFamily: 'Helvetica-Bold' },
  statusRejected: { color: C.red600, fontFamily: 'Helvetica-Bold' },

  // ── Totals ──
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

  empty: { paddingVertical: 30, textAlign: 'center', fontSize: 9, color: C.gray500 },

  // ── Footer ──
  footer: {
    position: 'absolute',
    bottom: 16,
    left: 28,
    right: 28,
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 0.5,
    borderTopColor: C.gray300,
    paddingTop: 4,
  },
  footerText: { fontSize: 6.5, color: C.gray500 },
})

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDateISO(iso: string | null | undefined): string {
  if (!iso) return '—'
  const [y, m, d] = iso.slice(0, 10).split('-')
  if (!y || !m || !d) return iso
  return `${d}-${m}-${y}`
}

const STATUS_LABEL: Record<string, string> = {
  approved: 'Aprobado',
  pending: 'Pendiente',
  rejected: 'Rechazado',
}

function statusStyle(status: string) {
  if (status === 'approved') return s.statusApproved
  if (status === 'pending') return s.statusPending
  if (status === 'rejected') return s.statusRejected
  return s.tdMuted
}

// ─── Document ─────────────────────────────────────────────────────────────────

export function MovementsPdf({ company, filters, rows, generatedBy }: MovementsPdfProps) {
  const companyName = company?.companyName ?? 'Empresa'
  const logo = company?.logoEmpresa ?? null
  const generatedAt = new Date().toLocaleString('es-PA', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })

  // Mini breakdown by type for the totals footer.
  const byType = new Map<string, number>()
  for (const r of rows) byType.set(r.typeName, (byType.get(r.typeName) ?? 0) + 1)
  const typeSummary = Array.from(byType.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => `${name}: ${count}`)
    .join('  ·  ')

  return (
    <Document title="Reporte de Movimientos de Expedientes" author="PayrollSoft">
      <Page size="A4" style={s.page} wrap>
        {/* ── Header (repeats on every page) ── */}
        <View style={s.header} fixed>
          <View style={s.brandRow}>
            {logo && <Image src={logo} style={s.logoImg} />}
            <Text style={s.companyName}>{companyName}</Text>
          </View>
          <Text style={s.reportTitle}>REPORTE DE MOVIMIENTOS DE EXPEDIENTES</Text>
        </View>

        {/* Filter chips (first page only) */}
        <View style={s.filterRow}>
          {filters.year && (
            <View style={s.chip}>
              <Text style={s.chipLabel}>Año:</Text>
              <Text style={s.chipValue}>{filters.year}</Text>
            </View>
          )}
          {(filters.from || filters.to) && (
            <View style={s.chip}>
              <Text style={s.chipLabel}>Rango:</Text>
              <Text style={s.chipValue}>
                {formatDateISO(filters.from)} → {formatDateISO(filters.to)}
              </Text>
            </View>
          )}
          {filters.typeName && (
            <View style={s.chip}>
              <Text style={s.chipLabel}>Tipo:</Text>
              <Text style={s.chipValue}>{filters.typeName}</Text>
            </View>
          )}
          {filters.subtypeName && (
            <View style={s.chip}>
              <Text style={s.chipLabel}>Subtipo:</Text>
              <Text style={s.chipValue}>{filters.subtypeName}</Text>
            </View>
          )}
        </View>

        {/* ── Table ── */}
        <View style={s.table}>
          <View style={s.tableHeader} fixed>
            <Text style={[s.th, s.colDoc]}>Nº Documento</Text>
            <Text style={[s.th, s.colDate]}>Fecha</Text>
            <Text style={[s.th, s.colEmployee]}>Empleado</Text>
            <Text style={[s.th, s.colType]}>Tipo</Text>
            <Text style={[s.th, s.colSubtype]}>Subtipo</Text>
            <Text style={[s.th, s.colStatus]}>Estado</Text>
            <Text style={[s.th, s.colUser]}>Creado por</Text>
          </View>

          {rows.length === 0 ? (
            <Text style={s.empty}>No hay movimientos para los filtros seleccionados.</Text>
          ) : (
            rows.map((r, i) => {
              const fullName = `${r.firstName} ${r.lastName}`.trim()
              return (
                <View
                  key={r.documentNumber}
                  style={[s.tr, i % 2 === 1 ? s.trAlt : {}]}
                  wrap={false}
                >
                  <Text style={[s.td, s.colDoc, s.tdMuted]}>{r.documentNumber}</Text>
                  <Text style={[s.td, s.colDate, s.tdMuted]}>{formatDateISO(r.documentDate)}</Text>
                  <Text style={[s.td, s.colEmployee]}>
                    {r.employeeCode} · {fullName}
                  </Text>
                  <Text style={[s.td, s.colType]}>{r.typeName}</Text>
                  <Text style={[s.td, s.colSubtype]}>{r.subtypeName}</Text>
                  <Text style={[s.td, s.colStatus, statusStyle(r.approvalStatus)]}>
                    {STATUS_LABEL[r.approvalStatus] ?? r.approvalStatus}
                  </Text>
                  <Text style={[s.td, s.colUser, s.tdMuted]}>{r.createdByName}</Text>
                </View>
              )
            })
          )}

          {rows.length > 0 && (
            <View style={s.totalsRow} wrap={false}>
              <Text style={[s.tdTotal, s.colDoc]}>TOTAL</Text>
              <Text style={[s.tdTotal, { width: '85%' }]}>
                {rows.length} {rows.length === 1 ? 'movimiento' : 'movimientos'}
                {typeSummary ? `   —   ${typeSummary}` : ''}
              </Text>
            </View>
          )}
        </View>

        {/* ── Footer ── */}
        <View style={s.footer} fixed>
          <Text style={s.footerText}>
            Generado: {generatedAt}
            {generatedBy?.name ? ` · por ${generatedBy.name}` : ''}
            {generatedBy?.email ? ` (${generatedBy.email})` : ''}
          </Text>
          <Text style={s.footerText}>{companyName} — Movimientos de Expedientes</Text>
          <Text
            style={s.footerText}
            render={({ pageNumber, totalPages }) => `Página ${pageNumber} de ${totalPages}`}
          />
        </View>
      </Page>
    </Document>
  )
}
