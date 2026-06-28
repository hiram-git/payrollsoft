import { Document, Font, Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer'

// Páginas de PayrollSoft (Recursos Humanos / Planilla y Asistencia) en el
// estilo del "Catálogo de Software" de RCG, con el contenido actualizado para
// Panamá. Pensadas para empalmarse dentro del catálogo original (Letter).

Font.registerHyphenationCallback((word) => [word])

const C = {
  maroon: '#681808', // marrón distintivo del catálogo (cabeceras, viñetas, pie)
  maroonDark: '#4A1106',
  ink: '#161412',
  body: '#1F1B19',
  white: '#ffffff',
  mute: '#6B5F5A',
}

const s = StyleSheet.create({
  page: {
    fontFamily: 'Helvetica',
    color: C.body,
    paddingBottom: 70,
  },

  // Header band with rounded bottom corners
  header: {
    backgroundColor: C.maroon,
    minHeight: 220,
    paddingTop: 56,
    paddingBottom: 30,
    paddingHorizontal: 40,
    justifyContent: 'center',
    alignItems: 'center',
    borderBottomLeftRadius: 26,
    borderBottomRightRadius: 64,
  },
  headerTitle: {
    fontSize: 25,
    fontFamily: 'Helvetica-Bold',
    color: C.white,
    textAlign: 'center',
    lineHeight: 1.18,
  },

  body: { paddingHorizontal: 52, paddingTop: 30 },
  intro: {
    fontSize: 11.5,
    fontFamily: 'Helvetica-Bold',
    color: C.ink,
    lineHeight: 1.5,
    textAlign: 'justify',
    marginBottom: 14,
  },
  subhead: {
    fontSize: 11.5,
    fontFamily: 'Helvetica-Bold',
    color: C.ink,
    marginBottom: 12,
  },

  bulletRow: { flexDirection: 'row', marginBottom: 9, alignItems: 'flex-start' },
  triangle: {
    width: 0,
    height: 0,
    borderTopWidth: 5,
    borderBottomWidth: 5,
    borderLeftWidth: 8,
    // react-pdf pinta 'transparent' como negro; las viñetas van sobre fondo
    // blanco, así que mezclamos los bordes con blanco para dejar un triángulo limpio.
    borderTopColor: C.white,
    borderBottomColor: C.white,
    borderLeftColor: C.maroon,
    marginTop: 3,
    marginRight: 9,
  },
  bulletText: {
    flex: 1,
    fontSize: 11,
    fontFamily: 'Helvetica-BoldOblique',
    color: C.ink,
    lineHeight: 1.4,
  },

  closing: {
    fontSize: 10.5,
    color: C.body,
    lineHeight: 1.5,
    textAlign: 'justify',
    marginTop: 14,
  },

  // Footer
  footer: {
    position: 'absolute',
    bottom: 26,
    left: 40,
    right: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  footerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  footerText: { fontSize: 11, fontFamily: 'Helvetica-Bold', color: C.maroon },
  footerLogo: { width: 46, height: 24, objectFit: 'contain' },
  pageCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: C.maroon,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pageNum: { fontSize: 14, fontFamily: 'Helvetica-Bold', color: C.white },
})

type CatalogPage = {
  title: string[]
  intro: string
  subhead?: string
  bullets: string[]
  closing?: string
  pageNumber: string
}

function CatalogProductPage({ data, logo }: { data: CatalogPage; logo?: string | null }) {
  return (
    <Page size="LETTER" style={s.page}>
      <View style={s.header}>
        <Text style={s.headerTitle}>{data.title.join('\n')}</Text>
      </View>

      <View style={s.body}>
        <Text style={s.intro}>{data.intro}</Text>
        {data.subhead ? <Text style={s.subhead}>{data.subhead}</Text> : null}

        {data.bullets.map((b) => (
          <View key={b} style={s.bulletRow} wrap={false}>
            <View style={s.triangle} />
            <Text style={s.bulletText}>{b}</Text>
          </View>
        ))}

        {data.closing ? <Text style={s.closing}>{data.closing}</Text> : null}
      </View>

      <View style={s.footer} fixed>
        <View style={s.footerLeft}>
          <Text style={s.footerText}>Software desarrollado por</Text>
          {logo ? <Image src={logo} style={s.footerLogo} /> : null}
        </View>
        <View style={s.pageCircle}>
          <Text style={s.pageNum}>{data.pageNumber}</Text>
        </View>
      </View>
    </Page>
  )
}

const PAYROLL_PAGE: CatalogPage = {
  title: ['Software de Recursos', 'Humanos y Planilla'],
  intro:
    'Esta herramienta digital optimiza toda la gestión del personal de tu empresa y automatiza las tareas relacionadas con las planillas, los salarios y el control de horarios — con el cumplimiento legal panameño incorporado y soporte real para múltiples empresas.',
  subhead: 'Principales funciones del software de RRHH y planilla:',
  bullets: [
    'Cálculo automático de planilla con un motor de fórmulas configurable (ingresos, deducciones y variables del empleado)',
    'Deducciones de ley: Seguro Social, Seguro Educativo, SIACAP e ISR',
    'Décimo tercer mes (XIII) calculado automáticamente',
    'Préstamos y acreedores con descuento automático y tabla de amortización',
    'Acumulados históricos por empleado y concepto',
    'Planilla oficial en PDF y comprobantes de pago',
    'Multi-empresa con datos aislados por cliente',
    'Portal de autoservicio para el empleado',
    'Roles, permisos y auditoría de cambios',
    'Disponible en web, escritorio (Windows) y móvil',
  ],
  closing:
    'Implementar el software de Recursos Humanos y Planilla de RCG SOFTRIX te brinda una administración intuitiva y automática del personal, ahorrando tiempo, reduciendo errores y manteniendo el cumplimiento con la CSS y la DGI.',
  pageNumber: '4',
}

const ATTENDANCE_PAGE: CatalogPage = {
  title: ['Software de Asistencia y', 'App móvil de marcación'],
  intro:
    'Sistema de monitoreo de entrada y salida de la jornada laboral de tus empleados. Registra las marcaciones (entrada, almuerzo y salida) con horarios y tolerancias configurables, y alimenta automáticamente el cálculo de la planilla. Se abandona por completo el uso de plantillas de Excel y papel, y todo se gestiona al alcance de un clic.',
  subhead: 'Beneficios del software de asistencia:',
  bullets: [
    'Marcación por reconocimiento facial y App móvil',
    'Horarios y tolerancias configurables por cada marcación',
    'Cálculo de minutos trabajados, tardanzas y horas extra',
    'Integración directa con el motor de planilla',
    'Elimina costos y el uso de Excel y papel',
    'Previene errores humanos y la pérdida de información',
    'Seguro: protege los datos y se gestiona desde cualquier lugar',
  ],
  closing:
    'Una herramienta innovadora y práctica que facilita la planificación del personal, asegura el rendimiento óptimo del colaborador y se integra de forma nativa con la planilla.',
  pageNumber: '5',
}

export function CatalogPayrollPages({ logo }: { logo?: string | null }) {
  return (
    <Document title="RCG SOFTRIX — Catálogo (RRHH y Asistencia)" author="RCG SOFTRIX">
      <CatalogProductPage data={PAYROLL_PAGE} logo={logo} />
      <CatalogProductPage data={ATTENDANCE_PAGE} logo={logo} />
    </Document>
  )
}
