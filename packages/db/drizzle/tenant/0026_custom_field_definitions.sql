-- Phase 8.1: catálogo de campos adicionales por tenant.
--
-- Cada tenant define sus propios campos extra para empleados (talla
-- camisa, cantidad de hijos, fecha de exámen médico, etc). Los valores
-- por empleado siguen viviendo en `employees.custom_fields` (jsonb)
-- — esta tabla es el catálogo que la UI usa para renderizar el
-- formulario y validar tipos al guardar.
--
-- Tipos soportados (validados a nivel app por `field_type`):
--   text     — string libre
--   integer  — entero
--   float    — número con decimales
--   date     — fecha YYYY-MM-DD
--
-- `default_value` y `validation_rules` viajan como jsonb para tener
-- flexibilidad sin volver a tocar el schema cuando aparezca un tipo
-- nuevo (boolean, select, multiselect, etc).

CREATE TABLE IF NOT EXISTS custom_field_definitions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  code            varchar(50)   NOT NULL,
  name            varchar(255)  NOT NULL,
  description     text,
  field_type      varchar(20)   NOT NULL,
  is_required     boolean       NOT NULL DEFAULT false,
  default_value   jsonb,
  validation_rules jsonb        NOT NULL DEFAULT '{}'::jsonb,
  sort_order      integer       NOT NULL DEFAULT 0,
  is_active       boolean       NOT NULL DEFAULT true,
  created_at      timestamptz   NOT NULL DEFAULT now(),
  updated_at      timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT custom_field_definitions_code_unique UNIQUE (code),
  CONSTRAINT custom_field_definitions_field_type_check CHECK (
    field_type IN ('text', 'integer', 'float', 'date')
  )
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS custom_field_definitions_active_idx
  ON custom_field_definitions (is_active, sort_order);
