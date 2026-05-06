/**
 * Constructores de documentos Word (.docx) para empleados.
 *
 * Tres documentos disponibles:
 *  - Contrato de trabajo: documento extenso con cláusulas básicas.
 *  - Certificación de trabajo: carta breve confirmando vínculo laboral.
 *  - Carta de trabajo: carta para trámites externos (banco, visa, etc).
 *
 * Cada función devuelve un `Buffer` con el `.docx` listo para servir.
 * Los textos legales son base — el área de RRHH debe revisarlos antes
 * de usar en producción. La idea es que la estructura quede armada y
 * los textos puedan editarse en una versión posterior con plantillas
 * `.docx` y docxtemplater.
 */
import { AlignmentType, Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx'

export type EmployeeForDoc = {
  id: string
  code: string
  firstName: string
  lastName: string
  idNumber: string
  position: string | null
  department: string | null
  baseSalary: string
  hireDate: string
  email?: string | null
  phone?: string | null
  payFrequency?: string | null
}

export type CompanyForDoc = {
  companyName: string | null
  ruc: string | null
  address: string | null
  city?: string | null
  representativeName?: string | null
  representativeTitle?: string | null
}

const PAY_FREQ_LABEL: Record<string, string> = {
  weekly: 'semanal',
  biweekly: 'quincenal',
  monthly: 'mensual',
}

function fmtSalary(v: string | number): string {
  const n = Number(v)
  if (!Number.isFinite(n)) return String(v)
  return n.toLocaleString('es-PA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDateLong(iso: string): string {
  if (!iso) return '—'
  const d = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('es-PA', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

function fmtToday(): string {
  return new Date().toLocaleDateString('es-PA', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

function fullName(emp: EmployeeForDoc): string {
  return `${emp.firstName} ${emp.lastName}`.trim()
}

function paragraph(
  text: string,
  opts?: {
    bold?: boolean
    align?: (typeof AlignmentType)[keyof typeof AlignmentType]
    spacing?: number
  }
) {
  return new Paragraph({
    alignment: opts?.align,
    spacing: { after: opts?.spacing ?? 200 },
    children: [new TextRun({ text, bold: opts?.bold })],
  })
}

function heading(text: string) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    alignment: AlignmentType.CENTER,
    spacing: { after: 300 },
    children: [new TextRun({ text, bold: true, size: 28 })],
  })
}

function blankLine() {
  return new Paragraph({ children: [new TextRun('')] })
}

function signatureBlock(label: string) {
  return [
    blankLine(),
    blankLine(),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: '_______________________________' })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: label, bold: true })],
    }),
  ]
}

async function pack(doc: Document): Promise<Buffer> {
  return Packer.toBuffer(doc)
}

// ── Contrato de trabajo ────────────────────────────────────────────────────

export async function buildContrato(
  employee: EmployeeForDoc,
  company: CompanyForDoc
): Promise<Buffer> {
  const empName = fullName(employee)
  const companyName = company.companyName ?? '[Empresa]'
  const repName = company.representativeName ?? '[Representante legal]'
  const repTitle = company.representativeTitle ?? '[Cargo del representante]'
  const positionText = employee.position ?? '[Posición]'
  const freq = PAY_FREQ_LABEL[employee.payFrequency ?? 'biweekly'] ?? 'quincenal'

  const doc = new Document({
    sections: [
      {
        properties: {},
        children: [
          heading('CONTRATO INDIVIDUAL DE TRABAJO'),
          paragraph(
            `Entre los suscritos: por una parte ${companyName}, con RUC ${
              company.ruc ?? '[RUC]'
            }, domiciliada en ${
              company.address ?? '[dirección]'
            }, representada en este acto por ${repName}, en su calidad de ${repTitle}, en adelante denominada "EL EMPLEADOR"; y por la otra parte ${empName}, con cédula de identidad personal número ${
              employee.idNumber
            }, en adelante denominado(a) "EL TRABAJADOR(A)", se ha convenido celebrar el presente contrato de trabajo conforme a las siguientes cláusulas:`,
            { spacing: 300 }
          ),
          paragraph('PRIMERA — OBJETO.', { bold: true }),
          paragraph(
            `EL TRABAJADOR(A) se compromete a prestar sus servicios personales al EMPLEADOR en la posición de ${positionText}${
              employee.department ? `, adscrito al departamento de ${employee.department}` : ''
            }, ejecutando todas las funciones inherentes al cargo y aquellas que le sean asignadas por sus supervisores conforme a la naturaleza del puesto.`
          ),
          paragraph('SEGUNDA — INICIO DE LA RELACIÓN.', { bold: true }),
          paragraph(
            `La relación de trabajo inicia el ${fmtDateLong(
              employee.hireDate
            )} y se regirá por lo dispuesto en el Código de Trabajo de la República de Panamá y demás normas concordantes.`
          ),
          paragraph('TERCERA — REMUNERACIÓN.', { bold: true }),
          paragraph(
            `EL EMPLEADOR pagará al TRABAJADOR(A) un salario base de B/. ${fmtSalary(
              employee.baseSalary
            )} con periodicidad ${freq}, sujeto a las deducciones de ley.`
          ),
          paragraph('CUARTA — JORNADA.', { bold: true }),
          paragraph(
            'El TRABAJADOR(A) cumplirá la jornada de trabajo establecida en el reglamento interno del EMPLEADOR, dentro de los límites fijados por el Código de Trabajo.'
          ),
          paragraph('QUINTA — CONFIDENCIALIDAD.', { bold: true }),
          paragraph(
            'EL TRABAJADOR(A) se obliga a guardar absoluta reserva sobre la información y los datos a los que tenga acceso con motivo de sus funciones, durante la vigencia del contrato y aún después de su terminación.'
          ),
          paragraph('SEXTA — TERMINACIÓN.', { bold: true }),
          paragraph(
            'El presente contrato podrá darse por terminado por cualquiera de las causas previstas en el Código de Trabajo. En caso de terminación, se liquidarán las prestaciones que correspondan conforme a la ley.'
          ),
          paragraph(
            `En constancia de aceptación, las partes firman el presente documento en dos ejemplares de igual tenor en ${
              company.city ?? 'Panamá'
            }, el ${fmtToday()}.`,
            { spacing: 400 }
          ),
          ...signatureBlock(`POR EL EMPLEADOR — ${repName}`),
          blankLine(),
          ...signatureBlock(`EL TRABAJADOR(A) — ${empName}`),
        ],
      },
    ],
  })

  return pack(doc)
}

// ── Certificación de trabajo ───────────────────────────────────────────────

export async function buildCertificacion(
  employee: EmployeeForDoc,
  company: CompanyForDoc
): Promise<Buffer> {
  const empName = fullName(employee)
  const companyName = company.companyName ?? '[Empresa]'
  const repName = company.representativeName ?? '[Representante legal]'
  const repTitle = company.representativeTitle ?? 'Recursos Humanos'

  const doc = new Document({
    sections: [
      {
        properties: {},
        children: [
          new Paragraph({
            alignment: AlignmentType.RIGHT,
            spacing: { after: 400 },
            children: [new TextRun({ text: fmtToday() })],
          }),
          heading('CERTIFICACIÓN DE TRABAJO'),
          paragraph(
            `Quien suscribe, en representación de ${companyName}, RUC ${
              company.ruc ?? '[RUC]'
            }, certifica por medio de la presente que:`,
            { spacing: 300 }
          ),
          paragraph(
            `${empName}, con cédula ${employee.idNumber}, labora en esta empresa desde el ${fmtDateLong(
              employee.hireDate
            )} desempeñando el cargo de ${employee.position ?? '[Posición]'}${
              employee.department ? `, en el departamento de ${employee.department}` : ''
            }.`
          ),
          paragraph(
            `Su salario actual es de B/. ${fmtSalary(employee.baseSalary)}, con frecuencia de pago ${
              PAY_FREQ_LABEL[employee.payFrequency ?? 'biweekly'] ?? 'quincenal'
            }.`
          ),
          paragraph(
            'La presente certificación se expide a solicitud del interesado(a) para los fines que estime convenientes.',
            { spacing: 400 }
          ),
          ...signatureBlock(`${repName}\n${repTitle}\n${companyName}`),
        ],
      },
    ],
  })

  return pack(doc)
}

// ── Carta de trabajo ───────────────────────────────────────────────────────

export async function buildCarta(
  employee: EmployeeForDoc,
  company: CompanyForDoc
): Promise<Buffer> {
  const empName = fullName(employee)
  const companyName = company.companyName ?? '[Empresa]'
  const repName = company.representativeName ?? '[Representante legal]'
  const repTitle = company.representativeTitle ?? 'Recursos Humanos'

  const doc = new Document({
    sections: [
      {
        properties: {},
        children: [
          new Paragraph({
            alignment: AlignmentType.RIGHT,
            spacing: { after: 400 },
            children: [new TextRun({ text: fmtToday() })],
          }),
          paragraph('A quien corresponda:', { bold: true, spacing: 300 }),
          paragraph(
            `Por medio de la presente, ${companyName} hace constar que ${empName}, con cédula ${
              employee.idNumber
            }, mantiene una relación laboral activa con esta empresa desde el ${fmtDateLong(
              employee.hireDate
            )}, ocupando actualmente el cargo de ${employee.position ?? '[Posición]'}.`
          ),
          paragraph(
            `Su remuneración mensual aproximada asciende a B/. ${fmtSalary(
              employee.baseSalary
            )} con frecuencia de pago ${
              PAY_FREQ_LABEL[employee.payFrequency ?? 'biweekly'] ?? 'quincenal'
            }.`
          ),
          paragraph(
            'Esta carta se emite a solicitud del interesado(a) para uso ante terceros, sin que ello implique compromiso adicional alguno por parte de la empresa.',
            { spacing: 400 }
          ),
          paragraph('Atentamente,', { spacing: 400 }),
          ...signatureBlock(`${repName}\n${repTitle}\n${companyName}`),
        ],
      },
    ],
  })

  return pack(doc)
}

export type DocumentType = 'contrato' | 'certificacion' | 'carta'

export const DOCUMENT_LABELS: Record<DocumentType, string> = {
  contrato: 'Contrato de trabajo',
  certificacion: 'Certificación de trabajo',
  carta: 'Carta de trabajo',
}

export async function buildEmployeeDocument(
  type: DocumentType,
  employee: EmployeeForDoc,
  company: CompanyForDoc
): Promise<Buffer> {
  switch (type) {
    case 'contrato':
      return buildContrato(employee, company)
    case 'certificacion':
      return buildCertificacion(employee, company)
    case 'carta':
      return buildCarta(employee, company)
  }
}
