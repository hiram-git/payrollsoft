-- 0006: Concept configuration tables
-- Extends concepts with behavior flags and adds 4 catalog + 4 junction tables

-- ── Extend concepts table ─────────────────────────────────────────────────────

ALTER TABLE concepts ADD COLUMN IF NOT EXISTS unit varchar(20) NOT NULL DEFAULT 'amount';
ALTER TABLE concepts ADD COLUMN IF NOT EXISTS print_details boolean NOT NULL DEFAULT false;
ALTER TABLE concepts ADD COLUMN IF NOT EXISTS prorates boolean NOT NULL DEFAULT false;
ALTER TABLE concepts ADD COLUMN IF NOT EXISTS allow_modify boolean NOT NULL DEFAULT false;
ALTER TABLE concepts ADD COLUMN IF NOT EXISTS is_reference_value boolean NOT NULL DEFAULT false;
ALTER TABLE concepts ADD COLUMN IF NOT EXISTS use_amount_calc boolean NOT NULL DEFAULT false;
ALTER TABLE concepts ADD COLUMN IF NOT EXISTS allow_zero boolean NOT NULL DEFAULT false;

--> statement-breakpoint

-- ── Catalog: Tipos de planilla ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS concept_payroll_types (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  code varchar(50) NOT NULL UNIQUE,
  name varchar(100) NOT NULL,
  sort_order integer NOT NULL DEFAULT 0
);

--> statement-breakpoint

-- ── Catalog: Frecuencias ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS concept_frequencies (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  code varchar(50) NOT NULL UNIQUE,
  name varchar(100) NOT NULL,
  sort_order integer NOT NULL DEFAULT 0
);

--> statement-breakpoint

-- ── Catalog: Situaciones del empleado ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS concept_situations (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  code varchar(50) NOT NULL UNIQUE,
  name varchar(100) NOT NULL,
  sort_order integer NOT NULL DEFAULT 0
);

--> statement-breakpoint

-- ── Catalog: Acumulados ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS concept_accumulators (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  code varchar(50) NOT NULL UNIQUE,
  name varchar(100) NOT NULL,
  sort_order integer NOT NULL DEFAULT 0
);

--> statement-breakpoint

-- ── Junction: Concepto ↔ Tipos de planilla ────────────────────────────────────

CREATE TABLE IF NOT EXISTS concept_payroll_type_links (
  concept_id uuid NOT NULL,
  payroll_type_id uuid NOT NULL,
  PRIMARY KEY (concept_id, payroll_type_id)
);

--> statement-breakpoint

-- ── Junction: Concepto ↔ Frecuencias ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS concept_frequency_links (
  concept_id uuid NOT NULL,
  frequency_id uuid NOT NULL,
  PRIMARY KEY (concept_id, frequency_id)
);

--> statement-breakpoint

-- ── Junction: Concepto ↔ Situaciones ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS concept_situation_links (
  concept_id uuid NOT NULL,
  situation_id uuid NOT NULL,
  PRIMARY KEY (concept_id, situation_id)
);

--> statement-breakpoint

-- ── Junction: Concepto ↔ Acumulados ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS concept_accumulator_links (
  concept_id uuid NOT NULL,
  accumulator_id uuid NOT NULL,
  PRIMARY KEY (concept_id, accumulator_id)
);

--> statement-breakpoint

-- ── Seed: Tipos de planilla ───────────────────────────────────────────────────

INSERT INTO concept_payroll_types (code, name, sort_order) VALUES
  ('regular',                 'Regular',                1),
  ('contingente',             'Contingente',            2),
  ('transitorio',             'Transitorio',            3),
  ('servicios_profesionales', 'Servicios Profesionales',4)
ON CONFLICT (code) DO NOTHING;

--> statement-breakpoint

-- ── Seed: Frecuencias ─────────────────────────────────────────────────────────

INSERT INTO concept_frequencies (code, name, sort_order) VALUES
  ('semanal',     'Semanal',    1),
  ('quincenal',   'Quincenal',  2),
  ('mensual',     'Mensual',    3),
  ('xiii_mes',    'XIII Mes',   4),
  ('vacacion',    'Vacación',   5),
  ('liquidacion', 'Liquidación',6)
ON CONFLICT (code) DO NOTHING;

--> statement-breakpoint

-- ── Seed: Situaciones ────────────────────────────────────────────────────────

INSERT INTO concept_situations (code, name, sort_order) VALUES
  ('activo',   'Activo',  1),
  ('baja',     'De Baja', 2),
  ('licencia', 'Licencia',3)
ON CONFLICT (code) DO NOTHING;

--> statement-breakpoint

-- ── Seed: Acumulados ─────────────────────────────────────────────────────────

INSERT INTO concept_accumulators (code, name, sort_order) VALUES
  ('xiii_mes',                  'XIII Mes',                    1),
  ('vacaciones',                'Vacaciones',                  2),
  ('indemnizacion',             'Indemnización',               3),
  ('prima_antiguedad',          'Prima de Antigüedad',         4),
  ('css_patronal',              'C.S.S. Patronal',             5),
  ('css_obrero',                'C.S.S. Obrero',               6),
  ('ir',                        'Imp. Sobre la Renta',         7),
  ('seguro_educativo_patronal', 'Seg. Educativo Patronal',     8),
  ('seguro_educativo_obrero',   'Seg. Educativo Obrero',       9)
ON CONFLICT (code) DO NOTHING;
