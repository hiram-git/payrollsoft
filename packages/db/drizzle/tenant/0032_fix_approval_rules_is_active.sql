-- Corrige la inconsistencia de tipo en `employee_file_approval_rules.is_active`.
--
-- La migración 0031 creó la columna como `boolean DEFAULT true`, pero
-- el schema Drizzle (`packages/db/src/schema/employee-files.ts`) y el
-- service (`createWithCorrelative`) la tratan como `integer DEFAULT 1`
-- — la convención del resto de tablas del módulo
-- (`employee_file_types`, `employee_file_subtypes`).
--
-- Sin esta corrección, comparaciones como `WHERE is_active = 1`
-- truenan con `42883 — el operador no existe: boolean = integer`
-- al intentar crear un expediente que dispara la evaluación de reglas.
--
-- Idempotente: si la columna ya es integer (instalaciones nuevas que
-- aplicaron una versión corregida), el USING cast no afecta nada.

ALTER TABLE employee_file_approval_rules
  ALTER COLUMN is_active DROP DEFAULT;
--> statement-breakpoint

ALTER TABLE employee_file_approval_rules
  ALTER COLUMN is_active TYPE integer
  USING (CASE WHEN is_active::text IN ('true', 't', '1') THEN 1 ELSE 0 END);
--> statement-breakpoint

ALTER TABLE employee_file_approval_rules
  ALTER COLUMN is_active SET DEFAULT 1,
  ALTER COLUMN is_active SET NOT NULL;
