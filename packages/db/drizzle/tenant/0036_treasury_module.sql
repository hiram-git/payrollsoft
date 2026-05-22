-- Módulo de Tesorería
--
-- Gestiona el pago efectivo después del cierre de planilla:
--   • Catálogo de bancos del país (con número de ruta para ACH)
--   • Datos bancarios en empleados y acreedores (ya existían en pivot
--     tables como JSON o ausentes; aquí se promueven a columnas reales)
--   • Chequeras (`treasury_checkbooks`) con próximo número correlativo
--   • Cheques (`treasury_checks`) emitidos a beneficiarios
--   • Lotes ACH (`treasury_ach_batches` + `_lines`) con el TXT generado
--   • Corridas de pago (`treasury_payment_runs`) — agrupa todo lo que
--     se pagó para una planilla específica: separa ACH vs cheque por
--     método de pago del beneficiario.
--
-- Estado del cheque:
--   issued  → emitido (asignado número desde la chequera)
--   printed → impreso (PDF/Excel generados al menos una vez)
--   cleared → conciliado contra estado de cuenta (manual por ahora)
--   voided  → anulado (libera el número, queda en histórico)

-- ─── Catálogo de bancos ────────────────────────────────────────────────
CREATE TABLE banks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        varchar(20)  NOT NULL UNIQUE,
  name        varchar(120) NOT NULL,
  routing     varchar(15),
  swift       varchar(15),
  country     varchar(2)   NOT NULL DEFAULT 'PA',
  is_active   integer      NOT NULL DEFAULT 1,
  sort_order  integer      NOT NULL DEFAULT 0,
  created_at  timestamptz  NOT NULL DEFAULT now()
);
--> statement-breakpoint

-- Seed inicial: bancos más usados en Panamá.
INSERT INTO banks (code, name, routing, sort_order) VALUES
  ('BNP',        'Banco Nacional de Panamá', NULL, 10),
  ('BGENERAL',   'Banco General',            NULL, 20),
  ('BANISTMO',   'Banistmo',                 NULL, 30),
  ('BAC',        'BAC Credomatic',           NULL, 40),
  ('CAJA',       'Caja de Ahorros',          NULL, 50),
  ('GLOBAL',     'Global Bank',              NULL, 60),
  ('MULTIBANK',  'Multibank',                NULL, 70),
  ('TOWERBANK',  'Towerbank',                NULL, 80)
ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint

-- ─── Columnas bancarias en employees ───────────────────────────────────
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS bank_id        uuid REFERENCES banks(id),
  ADD COLUMN IF NOT EXISTS account_number varchar(40),
  ADD COLUMN IF NOT EXISTS account_type   varchar(20),
  ADD COLUMN IF NOT EXISTS payment_method varchar(10) NOT NULL DEFAULT 'check';
--> statement-breakpoint

ALTER TABLE employees
  ADD CONSTRAINT employees_account_type_check
    CHECK (account_type IS NULL OR account_type IN ('savings', 'checking')),
  ADD CONSTRAINT employees_payment_method_check
    CHECK (payment_method IN ('ach', 'check', 'cash'));
--> statement-breakpoint

-- ─── Columnas bancarias en creditors ───────────────────────────────────
ALTER TABLE creditors
  ADD COLUMN IF NOT EXISTS bank_id        uuid REFERENCES banks(id),
  ADD COLUMN IF NOT EXISTS account_number varchar(40),
  ADD COLUMN IF NOT EXISTS account_type   varchar(20),
  ADD COLUMN IF NOT EXISTS payment_method varchar(10) NOT NULL DEFAULT 'check',
  ADD COLUMN IF NOT EXISTS beneficiary_name varchar(255);
--> statement-breakpoint

ALTER TABLE creditors
  ADD CONSTRAINT creditors_account_type_check
    CHECK (account_type IS NULL OR account_type IN ('savings', 'checking')),
  ADD CONSTRAINT creditors_payment_method_check
    CHECK (payment_method IN ('ach', 'check', 'cash'));
--> statement-breakpoint

-- ─── Chequeras ─────────────────────────────────────────────────────────
CREATE TABLE treasury_checkbooks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code            varchar(30)  NOT NULL UNIQUE,
  name            varchar(160) NOT NULL,
  bank_id         uuid REFERENCES banks(id),
  account_number  varchar(40)  NOT NULL,
  start_number    integer      NOT NULL,
  end_number      integer      NOT NULL,
  next_number     integer      NOT NULL,
  /** 'employees' | 'creditors' | 'general' — para qué se usa esta chequera */
  purpose         varchar(20)  NOT NULL DEFAULT 'general',
  is_active       integer      NOT NULL DEFAULT 1,
  created_at      timestamptz  NOT NULL DEFAULT now(),
  updated_at      timestamptz  NOT NULL DEFAULT now(),
  CHECK (start_number <= end_number),
  CHECK (next_number >= start_number AND next_number <= end_number + 1),
  CHECK (purpose IN ('employees', 'creditors', 'general'))
);
--> statement-breakpoint
CREATE INDEX treasury_checkbooks_bank_idx ON treasury_checkbooks(bank_id);
--> statement-breakpoint

-- ─── Corridas de pago (1 por planilla típicamente) ─────────────────────
CREATE TABLE treasury_payment_runs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_id  uuid REFERENCES payrolls(id) ON DELETE SET NULL,
  /** Etiqueta libre — ej. "Quincena Enero 2026" o "Acreedores Feb-15" */
  name        varchar(255) NOT NULL,
  /** 'draft' | 'open' | 'closed' | 'cancelled' */
  status      varchar(20)  NOT NULL DEFAULT 'draft',
  total_amount varchar(20) NOT NULL DEFAULT '0',
  ach_total    varchar(20) NOT NULL DEFAULT '0',
  check_total  varchar(20) NOT NULL DEFAULT '0',
  cash_total   varchar(20) NOT NULL DEFAULT '0',
  notes        text,
  created_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  closed_at    timestamptz,
  CHECK (status IN ('draft', 'open', 'closed', 'cancelled'))
);
--> statement-breakpoint
CREATE INDEX treasury_payment_runs_payroll_idx ON treasury_payment_runs(payroll_id);
--> statement-breakpoint

-- ─── Cheques emitidos ──────────────────────────────────────────────────
CREATE TABLE treasury_checks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checkbook_id    uuid NOT NULL REFERENCES treasury_checkbooks(id),
  check_number    integer NOT NULL,
  payment_run_id  uuid REFERENCES treasury_payment_runs(id) ON DELETE SET NULL,
  /** 'employee' | 'creditor' | 'other' */
  beneficiary_type   varchar(20) NOT NULL,
  /** Referencia opcional: employee_id o creditor_id según beneficiary_type */
  beneficiary_ref_id uuid,
  beneficiary_name   varchar(255) NOT NULL,
  amount             varchar(20) NOT NULL,
  amount_in_words    text NOT NULL,
  /** Concepto descriptivo del pago — "Quincena 1 Enero 2026", "Pago acreedor X", etc. */
  concept            text,
  issue_date         date NOT NULL,
  /** issued | printed | cleared | voided */
  status             varchar(20) NOT NULL DEFAULT 'issued',
  voided_at          timestamptz,
  void_reason        text,
  printed_at         timestamptz,
  cleared_at         date,
  created_by         uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (status IN ('issued', 'printed', 'cleared', 'voided')),
  CHECK (beneficiary_type IN ('employee', 'creditor', 'other'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX treasury_checks_checkbook_num_unique
  ON treasury_checks(checkbook_id, check_number)
  WHERE status <> 'voided';
--> statement-breakpoint
CREATE INDEX treasury_checks_run_idx ON treasury_checks(payment_run_id);
--> statement-breakpoint
CREATE INDEX treasury_checks_beneficiary_idx ON treasury_checks(beneficiary_type, beneficiary_ref_id);
--> statement-breakpoint

-- ─── Lotes ACH ─────────────────────────────────────────────────────────
CREATE TABLE treasury_ach_batches (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_run_id  uuid REFERENCES treasury_payment_runs(id) ON DELETE SET NULL,
  /** Banco que emite el TXT (origen de la transferencia) */
  source_bank_id  uuid REFERENCES banks(id),
  /** Identificador del formato — por ahora 'mupa_v1', se agregan más con el tiempo */
  format          varchar(30) NOT NULL DEFAULT 'mupa_v1',
  file_name       varchar(255) NOT NULL,
  total_amount    varchar(20)  NOT NULL DEFAULT '0',
  record_count    integer      NOT NULL DEFAULT 0,
  /** TXT generado completo — preservamos el contenido exacto que se descargó */
  file_content    text NOT NULL,
  generated_by    uuid,
  generated_at    timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX treasury_ach_batches_run_idx ON treasury_ach_batches(payment_run_id);
--> statement-breakpoint

CREATE TABLE treasury_ach_lines (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id      uuid NOT NULL REFERENCES treasury_ach_batches(id) ON DELETE CASCADE,
  employee_id   uuid REFERENCES employees(id) ON DELETE SET NULL,
  /** Snapshot del nombre al momento del pago — para auditabilidad si después cambia */
  beneficiary_name varchar(255) NOT NULL,
  identification   varchar(30),
  bank_routing     varchar(15),
  account_number   varchar(40)  NOT NULL,
  account_type     varchar(20)  NOT NULL,
  amount           varchar(20)  NOT NULL,
  CHECK (account_type IN ('savings', 'checking'))
);
--> statement-breakpoint
CREATE INDEX treasury_ach_lines_batch_idx ON treasury_ach_lines(batch_id);
--> statement-breakpoint
CREATE INDEX treasury_ach_lines_employee_idx ON treasury_ach_lines(employee_id);
