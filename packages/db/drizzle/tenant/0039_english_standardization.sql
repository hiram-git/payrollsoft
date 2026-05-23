-- Phase A: English standardization — rename 7 Spanish-named tables.
--
-- PostgreSQL ALTER TABLE RENAME is atomic and all FKs, indexes, and
-- constraints follow the table automatically. Existing data is
-- untouched — only the catalog entry changes.
--
-- Column renames for FK references that pointed to the old table
-- names are done in the same migration for consistency.

-- ─── Tables ──────────────────────────────────────────────────────────────

ALTER TABLE IF EXISTS cargos
  RENAME TO job_titles;
--> statement-breakpoint

ALTER TABLE IF EXISTS funciones
  RENAME TO job_functions;
--> statement-breakpoint

ALTER TABLE IF EXISTS departamentos
  RENAME TO departments;
--> statement-breakpoint

ALTER TABLE IF EXISTS partidas_presupuestarias
  RENAME TO budget_items;
--> statement-breakpoint

ALTER TABLE IF EXISTS cuentas_contables
  RENAME TO chart_of_accounts;
--> statement-breakpoint

ALTER TABLE IF EXISTS payroll_acumulados
  RENAME TO payroll_accumulators;
--> statement-breakpoint

-- facial_marcaciones is conditional (pgvector) — only rename if it exists.
ALTER TABLE IF EXISTS facial_marcaciones
  RENAME TO facial_punches;
--> statement-breakpoint

-- ─── Columns ─────────────────────────────────────────────────────────────
-- FK columns in employees that referenced Spanish table names.

ALTER TABLE employees
  RENAME COLUMN cargo_id TO job_title_id;
--> statement-breakpoint

ALTER TABLE employees
  RENAME COLUMN funcion_id TO job_function_id;
--> statement-breakpoint

ALTER TABLE employees
  RENAME COLUMN departamento_id TO department_id;
--> statement-breakpoint

-- FK columns in positions.
ALTER TABLE positions
  RENAME COLUMN cargo_id TO job_title_id;
--> statement-breakpoint

ALTER TABLE positions
  RENAME COLUMN funcion_id TO job_function_id;
--> statement-breakpoint

ALTER TABLE positions
  RENAME COLUMN departamento_id TO department_id;
--> statement-breakpoint

ALTER TABLE positions
  RENAME COLUMN partida_id TO budget_item_id;
--> statement-breakpoint

-- FK in concepts.
ALTER TABLE concepts
  RENAME COLUMN cuenta_contable_id TO chart_account_id;
--> statement-breakpoint

-- company_config columns.
ALTER TABLE company_config
  RENAME COLUMN tipo_institucion TO institution_type;
--> statement-breakpoint

ALTER TABLE company_config
  RENAME COLUMN elaborado_por TO prepared_by;
--> statement-breakpoint

ALTER TABLE company_config
  RENAME COLUMN cargo_elaborador TO preparer_title;
--> statement-breakpoint

ALTER TABLE company_config
  RENAME COLUMN jefe_recursos_humanos TO hr_director_name;
--> statement-breakpoint

ALTER TABLE company_config
  RENAME COLUMN cargo_jefe_rrhh TO hr_director_title;
--> statement-breakpoint

ALTER TABLE company_config
  RENAME COLUMN logo_empresa TO company_logo;
--> statement-breakpoint

ALTER TABLE company_config
  RENAME COLUMN logo_izquierdo_reportes TO report_logo_left;
--> statement-breakpoint

ALTER TABLE company_config
  RENAME COLUMN logo_derecho_reportes TO report_logo_right;
