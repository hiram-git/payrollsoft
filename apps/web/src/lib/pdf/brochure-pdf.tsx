import { Document, Font, Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer'

// Brochure ejecutivo de RCG SOFTRIX. Documento estático de marketing —
// no depende de datos de tenant. Se genera con scripts/generate-brochure.ts.

Font.registerHyphenationCallback((word) => [word])

// ─── Paleta (derivada del logo RCG SOFTRIX — gradiente rojo → marrón) ─────────

const C = {
  red: '#B11410', // rojo primario de marca (encabezados, header de tabla, CTA)
  redHi: '#D62118', // rojo vivo (eyebrows, viñetas, cifras de acento)
  redDeep: '#7A120E', // rojo oscuro del gradiente
  maroon: '#160504', // marrón casi negro (fondo de portada)
  maroonTop: '#9E140E', // rojo profundo (banda superior de portada)
  ink: '#1C1311', // negro cálido para texto de cuerpo
  ink2: '#3A2724', // texto secundario
  white: '#ffffff',
  fore: '#F3E9E8', // texto claro sobre fondo oscuro
  paper: '#FBF6F5', // gris cálido para filas alternas
  rule: '#E7DAD8', // borde cálido
  mute: '#8C7672', // apagado cálido
  mute2: '#B98F89',
  ok: '#2E7A56',
  accentSoft: '#FBE9E7', // tinte rojo suave (íconos de módulo)
  pillBg: '#260C0A',
  pillBorder: '#4A211D',
  onDarkSoft: '#F2C9C4', // rosa claro sobre fondo oscuro
  onDarkLede: '#FBE4E1',
  coverHr: '#3A1512',
}

// ─── Estilos ──────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  page: {
    fontFamily: 'Helvetica',
    fontSize: 9.5,
    color: C.ink,
    lineHeight: 1.5,
    paddingTop: 40,
    paddingBottom: 46,
    paddingHorizontal: 44,
  },

  // Cover
  cover: {
    fontFamily: 'Helvetica',
    color: C.white,
    backgroundColor: C.maroon,
    padding: 0,
  },
  coverTop: {
    backgroundColor: C.maroonTop,
    paddingTop: 54,
    paddingBottom: 44,
    paddingHorizontal: 48,
  },
  coverBrandRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 40 },
  coverLogoChip: {
    backgroundColor: C.white,
    borderRadius: 6,
    paddingVertical: 9,
    paddingHorizontal: 12,
  },
  coverMark: { width: 84, height: 22, objectFit: 'contain' },
  coverWordmark: { fontSize: 19, fontFamily: 'Helvetica-Bold', letterSpacing: 1.5, color: C.white },
  coverWordmarkSub: { fontSize: 8.5, color: C.onDarkSoft, letterSpacing: 0.5, marginTop: 1 },
  coverEyebrow: {
    fontSize: 9,
    color: C.onDarkSoft,
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginBottom: 12,
  },
  coverTitle: {
    fontSize: 30,
    fontFamily: 'Helvetica-Bold',
    color: C.white,
    lineHeight: 1.15,
    marginBottom: 14,
  },
  coverLede: { fontSize: 11.5, color: C.onDarkLede, lineHeight: 1.55, maxWidth: 430 },
  coverBottom: { paddingHorizontal: 48, paddingTop: 34, flex: 1 },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 30 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 5,
    paddingHorizontal: 11,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.pillBorder,
    backgroundColor: C.pillBg,
  },
  pillText: { fontSize: 8.5, color: C.fore, fontFamily: 'Helvetica-Bold', letterSpacing: 0.3 },
  coverStatsRow: { flexDirection: 'row', gap: 16, marginTop: 6 },
  coverStat: { flex: 1 },
  coverStatNum: { fontSize: 22, fontFamily: 'Helvetica-Bold', color: C.white },
  coverStatLabel: { fontSize: 8, color: C.mute2, marginTop: 2, lineHeight: 1.35 },
  coverFooter: {
    position: 'absolute',
    bottom: 30,
    left: 48,
    right: 48,
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 0.5,
    borderTopColor: C.coverHr,
    paddingTop: 10,
  },
  coverFooterText: { fontSize: 7.5, color: C.mute2 },

  // Section heads
  eyebrow: {
    fontSize: 8,
    color: C.redHi,
    letterSpacing: 1.6,
    textTransform: 'uppercase',
    fontFamily: 'Helvetica-Bold',
    marginBottom: 5,
  },
  h1: { fontSize: 17, fontFamily: 'Helvetica-Bold', color: C.red, marginBottom: 8 },
  lede: { fontSize: 10, color: C.ink2, lineHeight: 1.6, marginBottom: 16, maxWidth: 470 },
  hr: { borderBottomWidth: 1, borderBottomColor: C.rule, marginVertical: 4 },

  // Benefit cards (2 col)
  cardGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  card: {
    width: '48%',
    borderWidth: 1,
    borderColor: C.rule,
    borderRadius: 6,
    padding: 13,
    backgroundColor: C.white,
  },
  cardAccent: { borderLeftWidth: 3, borderLeftColor: C.red },
  cardTitle: {
    fontSize: 10.5,
    fontFamily: 'Helvetica-Bold',
    color: C.red,
    marginBottom: 4,
  },
  cardBody: { fontSize: 8.5, color: C.ink2, lineHeight: 1.5 },
  kicker: {
    fontSize: 7.5,
    color: C.redHi,
    fontFamily: 'Helvetica-Bold',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 5,
  },

  // Feature module rows
  modRow: { flexDirection: 'row', gap: 12, marginBottom: 11, alignItems: 'flex-start' },
  modIcon: {
    width: 26,
    height: 26,
    borderRadius: 5,
    backgroundColor: C.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modIconText: { fontSize: 11, fontFamily: 'Helvetica-Bold', color: C.red },
  modName: { fontSize: 10.5, fontFamily: 'Helvetica-Bold', color: C.ink, marginBottom: 1 },
  modDesc: { fontSize: 8.5, color: C.ink2, lineHeight: 1.45 },

  // Tech: two columns
  twoCol: { flexDirection: 'row', gap: 22 },
  colHalf: { flex: 1 },
  stackTable: { borderWidth: 1, borderColor: C.rule, borderRadius: 6, overflow: 'hidden' },
  stackRow: {
    flexDirection: 'row',
    borderBottomWidth: 0.5,
    borderBottomColor: C.rule,
    paddingVertical: 5,
    paddingHorizontal: 10,
  },
  stackRowAlt: { backgroundColor: C.paper },
  stackLayer: { width: '42%', fontSize: 8.5, color: C.mute, fontFamily: 'Helvetica-Bold' },
  stackTech: { width: '58%', fontSize: 8.5, color: C.ink },

  bullet: { flexDirection: 'row', gap: 6, marginBottom: 6 },
  bulletDot: { fontSize: 9, color: C.red, fontFamily: 'Helvetica-Bold' },
  bulletText: { fontSize: 8.7, color: C.ink2, lineHeight: 1.45, flex: 1 },
  bulletStrong: { fontFamily: 'Helvetica-Bold', color: C.ink },

  // Channels
  chanRow: { flexDirection: 'row', gap: 12, marginTop: 4 },
  chan: {
    flex: 1,
    borderWidth: 1,
    borderColor: C.rule,
    borderRadius: 6,
    padding: 11,
    backgroundColor: C.white,
  },
  chanTitle: { fontSize: 9.5, fontFamily: 'Helvetica-Bold', color: C.red, marginBottom: 3 },
  chanBody: { fontSize: 8, color: C.ink2, lineHeight: 1.45 },

  // CTA
  cta: {
    marginTop: 20,
    backgroundColor: C.red,
    borderRadius: 8,
    padding: 20,
  },
  ctaTitle: { fontSize: 13, fontFamily: 'Helvetica-Bold', color: C.white, marginBottom: 5 },
  ctaBody: { fontSize: 9, color: C.onDarkLede, lineHeight: 1.5, maxWidth: 420 },

  // Page footer
  footer: {
    position: 'absolute',
    bottom: 20,
    left: 44,
    right: 44,
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 0.5,
    borderTopColor: C.rule,
    paddingTop: 6,
  },
  footerText: { fontSize: 7, color: C.mute },
})

// ─── Contenido ────────────────────────────────────────────────────────────────

const BENEFITS: { kicker: string; title: string; body: string }[] = [
  {
    kicker: 'Cumplimiento',
    title: 'Hecho para Panamá',
    body: 'Planilla de sueldos en el formato oficial, deducciones de Seguro Social, Seguro Educativo, SIACAP e ISR, décimo tercer mes y reportes exigidos por la CSS. La normativa local viene incorporada, no es un añadido.',
  },
  {
    kicker: 'Multi-empresa',
    title: 'Una plataforma, todas sus empresas',
    body: 'Cada empresa opera con sus datos completamente aislados. Ideal para grupos corporativos y firmas de outsourcing de planilla que administran múltiples clientes desde un solo sistema.',
  },
  {
    kicker: 'Automatización',
    title: 'Menos cálculo manual, menos errores',
    body: 'Un motor de fórmulas configurable calcula cada ingreso y deducción automáticamente. Préstamos, acreedores y acumulados históricos se descuentan y registran solos en cada período.',
  },
  {
    kicker: 'Control',
    title: 'Procesos con trazabilidad',
    body: 'Las planillas siguen un ciclo controlado —generar, revisar, cerrar, reabrir— con validaciones en cada paso, auditoría de cambios y permisos por rol para cada usuario.',
  },
]

const MODULES: { tag: string; name: string; desc: string }[] = [
  {
    tag: 'RH',
    name: 'Planillas y Recursos Humanos',
    desc: 'Planillas regulares, especiales y décimo tercer mes. Frecuencia semanal, quincenal o mensual. Motor de fórmulas propio con acumulados históricos y desglose por concepto.',
  },
  {
    tag: 'P',
    name: 'Préstamos y acreedores',
    desc: 'Préstamos por empleado o globales con tabla de amortización y descuento automático en planilla. Cada acreedor genera su concepto de deducción vinculado.',
  },
  {
    tag: 'A',
    name: 'Asistencia y horarios',
    desc: 'Marcaciones de entrada, almuerzo y salida con horarios y tolerancias configurables. Los minutos trabajados, tardanzas y horas extra alimentan el cálculo de la planilla.',
  },
  {
    tag: 'E',
    name: 'Empleados y estructura',
    desc: 'Expediente de empleados, dependientes, cargos, funciones y departamentos en árbol. Posiciones reutilizables que combinan cargo, función, departamento y salario.',
  },
  {
    tag: 'R',
    name: 'Reportes y comprobantes',
    desc: 'Planilla oficial en PDF, listado de personal, recapitulación, SIACAP y comprobantes de pago. Capa de reportes extensible con exportación a Excel.',
  },
  {
    tag: 'F',
    name: 'Reconocimiento facial y portal',
    desc: 'Marcación biométrica por reconocimiento facial y portal de autoservicio para que el empleado consulte sus comprobantes y solicite vacaciones.',
  },
  {
    tag: 'V',
    name: 'Vacaciones y liquidaciones',
    desc: 'Cálculo de días ganados, solicitudes y saldos de vacaciones, con flujo de aprobaciones integrado al expediente del empleado.',
  },
  {
    tag: 'T',
    name: 'Tesorería',
    desc: 'Generación de transferencias bancarias y cheques a partir de la planilla cerrada, con sus comprobantes de pago listos para emitir.',
  },
]

const STACK: [string, string][] = [
  ['Runtime', 'Bun'],
  ['Backend', 'Elysia.js (API REST)'],
  ['Frontend', 'Astro 6 (SSR)'],
  ['Base de datos', 'PostgreSQL 16'],
  ['ORM', 'Drizzle ORM'],
  ['Escritorio', 'Tauri 2 (Windows)'],
]

// ─── Documento ────────────────────────────────────────────────────────────────

export function BrochurePdf({ logo }: { logo?: string | null }) {
  const year = new Date().getFullYear()

  const PageFooter = () => (
    <View style={s.footer} fixed>
      <Text style={s.footerText}>RCG SOFTRIX © {year}</Text>
      <Text style={s.footerText}>Recursos Humanos, Planilla y Asistencia · Panamá</Text>
      <Text
        style={s.footerText}
        render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`}
      />
    </View>
  )

  return (
    <Document
      title="RCG SOFTRIX — Brochure"
      author="RCG SOFTRIX"
      subject="Sistema de Recursos Humanos, Planilla y Asistencia"
    >
      {/* ── Portada ───────────────────────────────────────────── */}
      <Page size="A4" style={s.cover}>
        <View style={s.coverTop}>
          <View style={s.coverBrandRow}>
            {logo ? (
              <View style={s.coverLogoChip}>
                <Image src={logo} style={s.coverMark} />
              </View>
            ) : (
              <View style={[s.coverLogoChip, { width: 108, height: 40 }]} />
            )}
            <View>
              <Text style={s.coverWordmark}>RCG SOFTRIX</Text>
              <Text style={s.coverWordmarkSub}>Recursos Humanos, Planilla y Asistencia</Text>
            </View>
          </View>

          <Text style={s.coverEyebrow}>Software de nómina para Panamá</Text>
          <Text style={s.coverTitle}>
            Toda su planilla,{'\n'}bajo control
          </Text>
          <Text style={s.coverLede}>
            Una plataforma integral para administrar empleados, calcular planillas y registrar
            asistencia — con el cumplimiento legal panameño incorporado y soporte real para
            múltiples empresas.
          </Text>
        </View>

        <View style={s.coverBottom}>
          <View style={s.pillRow}>
            <View style={s.pill}>
              <Text style={s.pillText}>Multi-empresa</Text>
            </View>
            <View style={s.pill}>
              <Text style={s.pillText}>Motor de fórmulas</Text>
            </View>
            <View style={s.pill}>
              <Text style={s.pillText}>Reconocimiento facial</Text>
            </View>
            <View style={s.pill}>
              <Text style={s.pillText}>Portal del empleado</Text>
            </View>
            <View style={s.pill}>
              <Text style={s.pillText}>Reportes oficiales</Text>
            </View>
          </View>

          <View style={s.coverStatsRow}>
            <View style={s.coverStat}>
              <Text style={s.coverStatNum}>3</Text>
              <Text style={s.coverStatLabel}>Canales: web, escritorio y móvil</Text>
            </View>
            <View style={s.coverStat}>
              <Text style={s.coverStatNum}>100%</Text>
              <Text style={s.coverStatLabel}>Datos aislados por empresa</Text>
            </View>
            <View style={s.coverStat}>
              <Text style={s.coverStatNum}>CSS</Text>
              <Text style={s.coverStatLabel}>Deducciones y reportes de ley</Text>
            </View>
            <View style={s.coverStat}>
              <Text style={s.coverStatNum}>XIII</Text>
              <Text style={s.coverStatLabel}>Décimo tercer mes</Text>
            </View>
          </View>
        </View>

        <View style={s.coverFooter}>
          <Text style={s.coverFooterText}>RCG SOFTRIX © {year}</Text>
          <Text style={s.coverFooterText}>Brochure del sistema</Text>
        </View>
      </Page>

      {/* ── Página 2 · Beneficios ejecutivos ──────────────────── */}
      <Page size="A4" style={s.page}>
        <Text style={s.eyebrow}>Por qué RCG SOFTRIX</Text>
        <Text style={s.h1}>Una solución pensada para el día a día de planilla</Text>
        <Text style={s.lede}>
          RCG SOFTRIX reúne en un solo lugar todo lo que su equipo de Recursos Humanos necesita
          para correr la nómina sin sobresaltos: desde el expediente del empleado hasta el
          comprobante de pago, pasando por préstamos, asistencia y los reportes que exige la ley.
        </Text>

        <View style={s.cardGrid}>
          {BENEFITS.map((b) => (
            <View key={b.title} style={[s.card, s.cardAccent]}>
              <Text style={s.kicker}>{b.kicker}</Text>
              <Text style={s.cardTitle}>{b.title}</Text>
              <Text style={s.cardBody}>{b.body}</Text>
            </View>
          ))}
        </View>

        <View style={{ marginTop: 18 }}>
          <Text style={s.eyebrow}>Valor para el negocio</Text>
          <View style={s.bullet}>
            <Text style={s.bulletDot}>›</Text>
            <Text style={s.bulletText}>
              <Text style={s.bulletStrong}>Ahorro de tiempo:</Text> el cálculo, el descuento de
              préstamos y el registro de acumulados ocurren de forma automática en cada cierre.
            </Text>
          </View>
          <View style={s.bullet}>
            <Text style={s.bulletDot}>›</Text>
            <Text style={s.bulletText}>
              <Text style={s.bulletStrong}>Tranquilidad legal:</Text> formatos y deducciones
              alineados con la normativa panameña, listos para presentar.
            </Text>
          </View>
          <View style={s.bullet}>
            <Text style={s.bulletDot}>›</Text>
            <Text style={s.bulletText}>
              <Text style={s.bulletStrong}>Escala con usted:</Text> agregue empresas y empleados
              sin migrar de sistema ni mezclar información entre clientes.
            </Text>
          </View>
        </View>

        <PageFooter />
      </Page>

      {/* ── Página 3 · Módulos ────────────────────────────────── */}
      <Page size="A4" style={s.page}>
        <Text style={s.eyebrow}>Capacidades</Text>
        <Text style={s.h1}>Todo el ciclo de nómina, módulo por módulo</Text>
        <Text style={s.lede}>
          Cada módulo funciona de forma independiente y, a la vez, conectado: lo que ocurre en
          asistencia o en préstamos se refleja automáticamente en la planilla del período.
        </Text>

        {MODULES.map((m) => (
          <View key={m.name} style={s.modRow} wrap={false}>
            <View style={s.modIcon}>
              <Text style={s.modIconText}>{m.tag}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.modName}>{m.name}</Text>
              <Text style={s.modDesc}>{m.desc}</Text>
            </View>
          </View>
        ))}

        <PageFooter />
      </Page>

      {/* ── Página 4 · Técnico + cierre ───────────────────────── */}
      <Page size="A4" style={s.page}>
        <Text style={s.eyebrow}>Bajo el capó</Text>
        <Text style={s.h1}>Arquitectura moderna, segura y multi-empresa</Text>
        <Text style={s.lede}>
          Para los equipos de TI, RCG SOFTRIX está construido sobre tecnología actual con
          aislamiento real de datos por empresa y seguridad por capas.
        </Text>

        <View style={s.twoCol}>
          <View style={s.colHalf}>
            <Text style={s.kicker}>Stack técnico</Text>
            <View style={s.stackTable}>
              {STACK.map(([layer, tech], i) => (
                <View key={layer} style={[s.stackRow, i % 2 === 1 ? s.stackRowAlt : {}]}>
                  <Text style={s.stackLayer}>{layer}</Text>
                  <Text style={s.stackTech}>{tech}</Text>
                </View>
              ))}
            </View>
          </View>

          <View style={s.colHalf}>
            <Text style={s.kicker}>Diseño del sistema</Text>
            <View style={s.bullet}>
              <Text style={s.bulletDot}>›</Text>
              <Text style={s.bulletText}>
                <Text style={s.bulletStrong}>Multi-empresa por esquema:</Text> cada empresa en su
                propio esquema de base de datos, sin mezcla de datos y con respaldos por cliente.
              </Text>
            </View>
            <View style={s.bullet}>
              <Text style={s.bulletDot}>›</Text>
              <Text style={s.bulletText}>
                <Text style={s.bulletStrong}>Motor de fórmulas propio:</Text> lenguaje de
                expresiones seguro (sin <Text style={s.bulletStrong}>eval</Text>) para definir cada
                ingreso y deducción.
              </Text>
            </View>
            <View style={s.bullet}>
              <Text style={s.bulletDot}>›</Text>
              <Text style={s.bulletText}>
                <Text style={s.bulletStrong}>Seguridad por capas:</Text> autenticación JWT, roles
                jerárquicos, protección CSRF y límites de tasa en el acceso.
              </Text>
            </View>
            <View style={s.bullet}>
              <Text style={s.bulletDot}>›</Text>
              <Text style={s.bulletText}>
                <Text style={s.bulletStrong}>Auditoría:</Text> registro de cambios sobre las
                operaciones sensibles de planilla y configuración.
              </Text>
            </View>
          </View>
        </View>

        <View style={{ marginTop: 18 }}>
          <Text style={s.kicker}>Disponible donde trabaje su equipo</Text>
          <View style={s.chanRow}>
            <View style={s.chan}>
              <Text style={s.chanTitle}>Web</Text>
              <Text style={s.chanBody}>
                Acceso por navegador, sin instalación. Tema claro y oscuro.
              </Text>
            </View>
            <View style={s.chan}>
              <Text style={s.chanTitle}>Escritorio</Text>
              <Text style={s.chanBody}>
                Aplicación nativa para Windows con paridad total de funciones.
              </Text>
            </View>
            <View style={s.chan}>
              <Text style={s.chanTitle}>Móvil</Text>
              <Text style={s.chanBody}>
                Marcación de asistencia y reconocimiento facial desde el teléfono.
              </Text>
            </View>
          </View>
        </View>

        <View style={s.cta}>
          <Text style={s.ctaTitle}>¿Listo para simplificar su planilla?</Text>
          <Text style={s.ctaBody}>
            Solicite una demostración de RCG SOFTRIX y vea cómo administrar empleados, planillas y
            asistencia de todas sus empresas desde un solo sistema.
          </Text>
        </View>

        <PageFooter />
      </Page>
    </Document>
  )
}
