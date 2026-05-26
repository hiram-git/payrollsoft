/**
 * Catálogo de campos dinámicos por tipo (y opcionalmente por subtipo)
 * de expediente. Es la fuente de verdad para:
 *
 *   - el render del formulario en el frontend (qué inputs mostrar);
 *   - la validación server-side (qué campos son obligatorios);
 *   - el filtrado de `extra_fields` al persistir (solo se aceptan los
 *     campos declarados aquí — cualquier otra clave se descarta);
 *   - la separación entre `extra_fields` (JSONB) y `attachments`
 *     (campos `type: 'file'` van como filas en el storage físico).
 *
 * Los `code` de tipo/subtipo deben coincidir con los seedeados en
 * `0029_employee_files.sql` (snake_case). Si se agrega un tipo en la
 * BD sin entrada acá, el formulario solo mostrará los campos base
 * (fecha, observaciones, adjuntos genéricos).
 */

export type FieldType = 'text' | 'textarea' | 'date' | 'datetime' | 'number' | 'select' | 'file'

export type FieldDef = {
  name: string
  label: string
  type: FieldType
  required?: boolean
  readonly?: boolean
  placeholder?: string
  default?: string | number | null
  /** Solo para `select`. */
  options?: Array<{ value: string; label: string }>
  /** Solo para `number`. */
  step?: number
  /** Solo para `file`. */
  accept?: string
}

type TypeConfig = {
  /** Campos comunes a todos los subtipos del tipo. */
  base: FieldDef[]
  /** Campos extra que se agregan según el código del subtipo. */
  bySubtype?: Record<string, FieldDef[]>
}

const FILE_ACCEPT = 'application/pdf,image/jpeg,image/png,image/gif'

const SELECT_YES_NO: FieldDef['options'] = [
  { value: 'si', label: 'Sí' },
  { value: 'no', label: 'No' },
]

const SCHEDULE: FieldDef['options'] = [
  { value: 'manana', label: 'Mañana' },
  { value: 'tarde', label: 'Tarde' },
  { value: 'noche', label: 'Noche' },
]

const MATERNITY: FieldDef['options'] = [
  { value: 'prenatal', label: 'Prenatal' },
  { value: 'postnatal', label: 'Postnatal' },
]

/**
 * Conjuntos reutilizables — declarados arriba para no duplicar las
 * licencias con/sin sueldo/especiales.
 */
const LICENSE_COMMON_PAID: FieldDef[] = [
  { name: 'start_date', label: 'Fecha inicio', type: 'date', required: true },
  { name: 'end_date', label: 'Fecha fin', type: 'date', required: true },
  {
    name: 'total_days',
    label: 'Total de días concedidos',
    type: 'number',
    step: 1,
    required: true,
  },
  {
    name: 'paid_license',
    label: 'Goza de remuneración',
    type: 'select',
    required: true,
    default: 'si',
    options: SELECT_YES_NO,
  },
  { name: 'license_reason_detail', label: 'Motivo', type: 'textarea' },
  { name: 'authorized_by', label: 'Autorizado por', type: 'text' },
  { name: 'resolution_number', label: 'Resolución', type: 'text' },
  { name: 'resolution_file', label: 'Documento de respaldo', type: 'file', accept: FILE_ACCEPT },
]

const LICENSE_COMMON_UNPAID: FieldDef[] = [
  { name: 'start_date', label: 'Fecha inicio', type: 'date', required: true },
  { name: 'end_date', label: 'Fecha fin', type: 'date', required: true },
  { name: 'total_days', label: 'Total de días', type: 'number', step: 1, required: true },
  {
    name: 'paid_license',
    label: 'Goza de remuneración',
    type: 'text',
    readonly: true,
    default: 'No',
  },
  { name: 'license_reason_detail', label: 'Motivo', type: 'textarea' },
  { name: 'approved_by', label: 'Aprobado por', type: 'text' },
  {
    name: 'approval_document',
    label: 'Documento de aprobación',
    type: 'file',
    accept: FILE_ACCEPT,
  },
]

const LICENSE_COMMON_SPECIAL: FieldDef[] = [
  { name: 'start_date', label: 'Fecha inicio', type: 'date', required: true },
  { name: 'end_date', label: 'Fecha fin (si aplica)', type: 'date' },
  {
    name: 'total_days',
    label: 'Total de días (o hasta recuperación)',
    type: 'text',
    required: true,
    placeholder: 'Hasta recuperación',
  },
  {
    name: 'diagnosis',
    label: 'Diagnóstico o justificación médica',
    type: 'textarea',
    required: true,
  },
  { name: 'medical_center', label: 'Centro médico', type: 'text' },
  { name: 'doctor_name', label: 'Médico tratante', type: 'text' },
  {
    name: 'medical_file',
    label: 'Dictamen médico o certificado',
    type: 'file',
    required: true,
    accept: FILE_ACCEPT,
  },
]

export const DYNAMIC_FIELDS: Record<string, TypeConfig> = {
  estudios_academicos: {
    base: [
      { name: 'institution', label: 'Institución', type: 'text', required: true },
      { name: 'title_obtained', label: 'Título obtenido', type: 'text', required: true },
      { name: 'start_date', label: 'Fecha inicio', type: 'date' },
      { name: 'end_date', label: 'Fecha fin', type: 'date' },
      { name: 'registration_number', label: 'Número de registro', type: 'text' },
      { name: 'resolution_number', label: 'Número de resolución', type: 'text' },
      { name: 'title_file', label: 'Archivo del título', type: 'file', accept: FILE_ACCEPT },
    ],
  },
  capacitacion: {
    base: [
      { name: 'event_name', label: 'Nombre del evento', type: 'text', required: true },
      { name: 'organizer', label: 'Institución organizadora', type: 'text' },
      { name: 'hours', label: 'Horas de duración', type: 'number', step: 0.5 },
      { name: 'event_date', label: 'Fecha del evento', type: 'date' },
      { name: 'certificate_file', label: 'Certificado', type: 'file', accept: FILE_ACCEPT },
    ],
  },
  permisos: {
    base: [
      { name: 'start_datetime', label: 'Fecha y hora inicio', type: 'datetime' },
      { name: 'end_datetime', label: 'Fecha y hora fin', type: 'datetime' },
      { name: 'reason_detail', label: 'Motivo detallado', type: 'textarea' },
      { name: 'immediate_boss', label: 'Jefe inmediato', type: 'text' },
      {
        name: 'justification_file',
        label: 'Archivo justificativo',
        type: 'file',
        accept: FILE_ACCEPT,
      },
    ],
  },
  amonestaciones: {
    base: [
      { name: 'incident_date', label: 'Fecha del incidente', type: 'date' },
      { name: 'incident_description', label: 'Descripción del hecho', type: 'textarea' },
      { name: 'resolution_number', label: 'Resolución', type: 'text' },
      {
        name: 'resolution_file',
        label: 'Archivo de resolución',
        type: 'file',
        accept: FILE_ACCEPT,
      },
    ],
  },
  movimiento_personal: {
    base: [
      { name: 'movement_date', label: 'Fecha del movimiento', type: 'date' },
      { name: 'previous_position', label: 'Cargo/posición anterior', type: 'text' },
      { name: 'new_position', label: 'Nuevo cargo/posición', type: 'text' },
      { name: 'resolution_number', label: 'Resolución', type: 'text' },
      {
        name: 'resolution_file',
        label: 'Documento del movimiento',
        type: 'file',
        accept: FILE_ACCEPT,
      },
    ],
  },
  evaluacion_desempeno: {
    base: [
      { name: 'evaluation_period', label: 'Período evaluado', type: 'text' },
      { name: 'evaluation_date', label: 'Fecha de evaluación', type: 'date' },
      { name: 'evaluator', label: 'Evaluador', type: 'text' },
      { name: 'score', label: 'Puntaje', type: 'number', step: 0.01 },
    ],
  },
  vacaciones: {
    base: [
      { name: 'period_start', label: 'Período inicio', type: 'date' },
      { name: 'period_end', label: 'Período fin', type: 'date' },
      { name: 'days_requested', label: 'Días solicitados', type: 'number', step: 1 },
      { name: 'balance_before', label: 'Saldo anterior', type: 'number', step: 0.01 },
      { name: 'balance_after', label: 'Saldo posterior', type: 'number', step: 0.01 },
    ],
  },
  tiempo_compensatorio: {
    base: [
      { name: 'movement_date', label: 'Fecha del movimiento', type: 'date' },
      { name: 'hours_adjusted', label: 'Horas ajustadas', type: 'number', step: 0.25 },
      { name: 'balance_before', label: 'Saldo anterior', type: 'number', step: 0.25 },
      { name: 'balance_after', label: 'Saldo posterior', type: 'number', step: 0.25 },
    ],
  },
  ausencias: {
    base: [
      { name: 'absence_date', label: 'Fecha de ausencia', type: 'date', required: true },
      { name: 'end_date', label: 'Fecha fin (si aplica)', type: 'date' },
      { name: 'hours', label: 'Horas solicitadas', type: 'number', step: 0.5, required: true },
      { name: 'reason_detail', label: 'Motivo detallado', type: 'textarea', required: true },
      {
        name: 'justification_file',
        label: 'Documento justificativo',
        type: 'file',
        accept: FILE_ACCEPT,
      },
    ],
    bySubtype: {
      enfermedad: [
        { name: 'medical_center', label: 'Centro médico', type: 'text' },
        {
          name: 'medical_certificate',
          label: 'Certificado médico',
          type: 'file',
          required: true,
          accept: FILE_ACCEPT,
        },
      ],
      duelo: [
        {
          name: 'relationship',
          label: 'Parentesco con el fallecido',
          type: 'text',
          required: true,
        },
        {
          name: 'death_certificate',
          label: 'Certificado de defunción',
          type: 'file',
          accept: FILE_ACCEPT,
        },
      ],
      matrimonio: [
        { name: 'wedding_date', label: 'Fecha de matrimonio', type: 'date', required: true },
      ],
      nacimiento_hijo: [
        { name: 'child_birth_date', label: 'Fecha de nacimiento', type: 'date', required: true },
        {
          name: 'birth_certificate',
          label: 'Certificado de nacimiento',
          type: 'file',
          accept: FILE_ACCEPT,
        },
      ],
      enfermedad_pariente: [
        { name: 'relative_name', label: 'Nombre del pariente', type: 'text', required: true },
        { name: 'relationship', label: 'Parentesco', type: 'text', required: true },
        {
          name: 'medical_certificate',
          label: 'Certificado médico',
          type: 'file',
          accept: FILE_ACCEPT,
        },
      ],
    },
  },
  tardanzas: {
    base: [
      { name: 'tardiness_date', label: 'Fecha de tardanza', type: 'date', required: true },
      {
        name: 'minutes_late',
        label: 'Minutos de tardanza',
        type: 'number',
        step: 1,
        required: true,
      },
      { name: 'reason_detail', label: 'Motivo detallado', type: 'textarea', required: true },
      {
        name: 'justification_file',
        label: 'Documento justificativo',
        type: 'file',
        accept: FILE_ACCEPT,
      },
    ],
    bySubtype: {
      cita_medica: [
        {
          name: 'appointment_proof',
          label: 'Comprobante de cita',
          type: 'file',
          required: true,
          accept: FILE_ACCEPT,
        },
      ],
    },
  },
  horas_extra: {
    base: [
      { name: 'overtime_date', label: 'Fecha', type: 'date', required: true },
      {
        name: 'hours_worked',
        label: 'Horas trabajadas',
        type: 'number',
        step: 0.5,
        required: true,
      },
      {
        name: 'start_time',
        label: 'Hora inicio',
        type: 'text',
        required: true,
        placeholder: 'HH:MM',
      },
      { name: 'end_time', label: 'Hora fin', type: 'text', required: true, placeholder: 'HH:MM' },
      { name: 'reason', label: 'Motivo', type: 'textarea', required: true },
      { name: 'authorized_by', label: 'Autorizado por', type: 'text' },
    ],
  },
  omisiones: {
    base: [
      { name: 'omission_date', label: 'Fecha de la omisión', type: 'date', required: true },
      { name: 'reason_detail', label: 'Motivo de la omisión', type: 'textarea', required: true },
    ],
    bySubtype: {
      omision_entrada: [
        {
          name: 'actual_arrival',
          label: 'Hora real de llegada',
          type: 'text',
          required: true,
          placeholder: 'HH:MM',
        },
      ],
      omision_salida: [
        {
          name: 'actual_departure',
          label: 'Hora real de salida',
          type: 'text',
          required: true,
          placeholder: 'HH:MM',
        },
      ],
      omision_ambas: [
        {
          name: 'actual_arrival',
          label: 'Hora real de llegada',
          type: 'text',
          required: true,
          placeholder: 'HH:MM',
        },
        {
          name: 'actual_departure',
          label: 'Hora real de salida',
          type: 'text',
          required: true,
          placeholder: 'HH:MM',
        },
      ],
    },
  },
  cumpleanos: {
    base: [{ name: 'birthday_date', label: 'Fecha de cumpleaños', type: 'date', required: true }],
  },
  mision_oficial: {
    base: [
      { name: 'start_date', label: 'Fecha inicio', type: 'date', required: true },
      { name: 'end_date', label: 'Fecha fin', type: 'date', required: true },
      { name: 'destination', label: 'Destino', type: 'text', required: true },
      { name: 'purpose', label: 'Propósito de la misión', type: 'textarea', required: true },
      { name: 'total_days', label: 'Total de días', type: 'number', step: 1, required: true },
      { name: 'authorized_by', label: 'Autorizado por', type: 'text' },
      {
        name: 'authorization_file',
        label: 'Documento de autorización',
        type: 'file',
        accept: FILE_ACCEPT,
      },
    ],
    bySubtype: {
      internacional: [
        { name: 'country', label: 'País de destino', type: 'text', required: true },
        { name: 'per_diem', label: 'Viáticos diarios (USD)', type: 'number', step: 0.01 },
      ],
    },
  },
  documento: {
    base: [
      { name: 'document_type', label: 'Tipo de documento', type: 'text' },
      { name: 'issue_date', label: 'Fecha de emisión', type: 'date' },
      { name: 'expiration_date', label: 'Fecha de vencimiento', type: 'date' },
      { name: 'issuing_authority', label: 'Entidad emisora', type: 'text' },
      { name: 'document_file', label: 'Documento principal', type: 'file', accept: FILE_ACCEPT },
    ],
  },
  experiencia: {
    base: [
      { name: 'company_name', label: 'Institución/empresa', type: 'text' },
      { name: 'role', label: 'Cargo desempeñado', type: 'text' },
      { name: 'start_date', label: 'Fecha inicio', type: 'date' },
      { name: 'end_date', label: 'Fecha fin', type: 'date' },
      { name: 'reference_contact', label: 'Referencia/Contacto', type: 'text' },
    ],
  },
  licencias_con_sueldo: {
    base: LICENSE_COMMON_PAID,
    bySubtype: {
      representacion_institucional: [
        { name: 'representation_entity', label: 'Entidad representada', type: 'text' },
        { name: 'representation_place', label: 'Lugar', type: 'text' },
        { name: 'representation_activity', label: 'Actividad', type: 'textarea' },
      ],
      estudios: [
        { name: 'study_program', label: 'Programa de estudio', type: 'text' },
        { name: 'study_institution', label: 'Institución', type: 'text' },
        { name: 'study_schedule', label: 'Horario', type: 'select', options: SCHEDULE },
      ],
      representacion_asociacion: [
        { name: 'association_name', label: 'Asociación', type: 'text' },
        { name: 'association_role', label: 'Cargo en la asociación', type: 'text' },
        { name: 'association_activity', label: 'Actividad', type: 'textarea' },
      ],
      capacitacion: [
        { name: 'training_name', label: 'Capacitación', type: 'text' },
        { name: 'training_organizer', label: 'Organizador', type: 'text' },
        { name: 'training_hours', label: 'Horas', type: 'number', step: 0.5 },
      ],
      razones_extraordinarias: [
        { name: 'extraordinary_reason', label: 'Razón extraordinaria', type: 'textarea' },
      ],
    },
  },
  licencias_sin_sueldo: {
    base: LICENSE_COMMON_UNPAID,
    bySubtype: {
      cargo_eleccion_popular: [
        { name: 'public_position', label: 'Cargo público', type: 'text' },
        { name: 'public_entity', label: 'Entidad', type: 'text' },
        { name: 'public_term', label: 'Período', type: 'text' },
      ],
      asuntos_personales: [{ name: 'personal_reason', label: 'Motivo personal', type: 'textarea' }],
      libre_nombramiento: [
        { name: 'appointment_position', label: 'Cargo', type: 'text' },
        { name: 'appointment_institution', label: 'Institución', type: 'text' },
        {
          name: 'appointment_file',
          label: 'Documento del nombramiento',
          type: 'file',
          required: true,
          accept: FILE_ACCEPT,
        },
      ],
      estudiar: [
        { name: 'study_program', label: 'Programa', type: 'text' },
        { name: 'study_institution', label: 'Institución', type: 'text' },
        { name: 'study_duration', label: 'Duración', type: 'text' },
      ],
    },
  },
  licencias_especiales: {
    base: LICENSE_COMMON_SPECIAL,
    bySubtype: {
      enfermedad_profesional: [
        { name: 'professional_report', label: 'Reporte profesional', type: 'textarea' },
        { name: 'issuing_entity', label: 'Entidad emisora', type: 'text' },
      ],
      riesgos_profesionales: [
        { name: 'professional_report', label: 'Reporte profesional', type: 'textarea' },
        { name: 'issuing_entity', label: 'Entidad emisora', type: 'text' },
      ],
      incapacidad_15dias: [{ name: 'rest_days', label: 'Días de reposo', type: 'number', step: 1 }],
      gravidez: [
        { name: 'due_date', label: 'Fecha probable de parto', type: 'date' },
        { name: 'gestation_weeks', label: 'Semanas de gestación', type: 'number', step: 1 },
        {
          name: 'maternity_stage',
          label: 'Etapa de maternidad',
          type: 'select',
          options: MATERNITY,
        },
      ],
    },
  },
}

/**
 * Devuelve la lista completa de campos para un par (tipo, subtipo).
 * Si el tipo no está registrado, devuelve `[]`.
 */
export function getFieldsFor(typeCode: string, subtypeCode: string | null): FieldDef[] {
  const cfg = DYNAMIC_FIELDS[typeCode]
  if (!cfg) return []
  const extras = subtypeCode && cfg.bySubtype ? (cfg.bySubtype[subtypeCode] ?? []) : []
  return [...cfg.base, ...extras]
}

/**
 * Particiona los campos en (no-file, file). Los primeros van al
 * jsonb `extra_fields`; los segundos esperan filas en attachments.
 */
export function splitFieldsByKind(fields: FieldDef[]): { scalar: FieldDef[]; files: FieldDef[] } {
  const scalar: FieldDef[] = []
  const files: FieldDef[] = []
  for (const f of fields) {
    if (f.type === 'file') files.push(f)
    else scalar.push(f)
  }
  return { scalar, files }
}
