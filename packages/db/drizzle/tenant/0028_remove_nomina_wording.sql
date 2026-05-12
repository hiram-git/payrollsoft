-- Normaliza los nombres "Nómina X" y el default "Especialista en Nóminas"
-- que arrastran tenants creados antes de unificar la nomenclatura del
-- sistema. El sistema usa "planilla" en toda la UI y los catálogos
-- nuevos; este migration alinea los datos existentes.
--
-- Idempotente: cada UPDATE filtra por el valor viejo, así re-aplicar
-- la migración no altera filas que el operador haya renombrado a algo
-- distinto a propósito. El ALTER COLUMN ... SET DEFAULT cambia solo el
-- default, no toca rows existentes.

UPDATE "concept_payroll_types" SET "name" = 'Regular'      WHERE "name" = 'Nómina Regular';
UPDATE "concept_payroll_types" SET "name" = 'Transitoria'  WHERE "name" = 'Nómina Transitoria';
UPDATE "concept_payroll_types" SET "name" = 'Contingencia' WHERE "name" = 'Nómina Contingencia';

--> statement-breakpoint

UPDATE "company_config"
   SET "cargo_elaborador" = 'Especialista en Planilla'
 WHERE "cargo_elaborador" = 'Especialista en Nóminas';

--> statement-breakpoint

ALTER TABLE "company_config"
  ALTER COLUMN "cargo_elaborador" SET DEFAULT 'Especialista en Planilla';
