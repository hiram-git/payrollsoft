-- Configuración de tipos de expediente para ausencias/tardanzas
-- automáticas y soporte para justificaciones.

-- Campos en company_config para vincular asistencia con expedientes.
-- El admin configura qué tipo/subtipo de expediente se crea
-- automáticamente cuando el consolidador detecta una ausencia o tardanza.
ALTER TABLE company_config
  ADD COLUMN IF NOT EXISTS absence_file_type_id integer,
  ADD COLUMN IF NOT EXISTS absence_file_subtype_id integer,
  ADD COLUMN IF NOT EXISTS lateness_file_type_id integer,
  ADD COLUMN IF NOT EXISTS lateness_file_subtype_id integer;
--> statement-breakpoint

-- Nuevo status 'justified' para attendance_records.
-- El CHECK anterior solo tenía 'present' como default; ahora
-- validamos el conjunto completo.
ALTER TABLE attendance_records
  DROP CONSTRAINT IF EXISTS attendance_records_status_check;
--> statement-breakpoint

-- Tabla de justificaciones — enlaza un expediente (employee_file)
-- con un registro de asistencia. Al aprobar la justificación,
-- el status de attendance_records cambia a 'justified'.
CREATE TABLE IF NOT EXISTS attendance_justifications (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attendance_id   uuid NOT NULL REFERENCES attendance_records(id) ON DELETE CASCADE,
  employee_id     uuid NOT NULL,
  employee_file_id uuid,
  reason          text,
  status          varchar(20) NOT NULL DEFAULT 'pending',
  submitted_at    timestamptz NOT NULL DEFAULT now(),
  reviewed_by     uuid,
  reviewed_at     timestamptz,
  review_notes    text,
  CONSTRAINT justification_status_check
    CHECK (status IN ('pending', 'approved', 'rejected'))
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS attendance_justifications_att_idx
  ON attendance_justifications(attendance_id);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS attendance_justifications_emp_idx
  ON attendance_justifications(employee_id);
