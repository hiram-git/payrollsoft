-- Phase 8.2: historial de cambios de valores de campos adicionales.
--
-- Cada vez que el valor de un campo adicional cambia para un empleado
-- se inserta una fila aquí con el valor anterior, el nuevo y quién lo
-- modificó. Las filas no se editan ni se borran — son solo append.

CREATE TABLE IF NOT EXISTS custom_field_value_history (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  employee_id uuid NOT NULL,
  field_code  varchar(50) NOT NULL,
  old_value   jsonb,
  new_value   jsonb,
  changed_by  uuid,
  changed_at  timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS custom_field_value_history_employee_idx
  ON custom_field_value_history (employee_id, changed_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS custom_field_value_history_field_idx
  ON custom_field_value_history (field_code, changed_at DESC);
