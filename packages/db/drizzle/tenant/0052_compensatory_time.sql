-- Compensatory time balances and movements
-- Three pools per employee per year:
--   compensatory       — 144 hours general (all employees)
--   disability         — 144 hours (employee has disability)
--   family_disability  — 144 hours (employee has dependent with disability)
--
-- Movements track every change (initialization, overtime, absence, lateness, etc.)

CREATE TABLE IF NOT EXISTS compensatory_time_balances (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id     UUID NOT NULL,
  pool            VARCHAR(30) NOT NULL,
  earned          NUMERIC(8,2) NOT NULL DEFAULT 0,
  used            NUMERIC(8,2) NOT NULL DEFAULT 0,
  reserved        NUMERIC(8,2) NOT NULL DEFAULT 0,
  year            INTEGER NOT NULL,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS comp_time_bal_emp_pool_year_unique
  ON compensatory_time_balances (employee_id, pool, year);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS comp_time_bal_employee_idx
  ON compensatory_time_balances (employee_id);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS compensatory_time_movements (
  id               BIGSERIAL PRIMARY KEY,
  employee_id      UUID NOT NULL,
  pool             VARCHAR(30) NOT NULL,
  movement_type    VARCHAR(30) NOT NULL,
  hours            NUMERIC(8,2) NOT NULL,
  balance_before   NUMERIC(8,2) NOT NULL,
  balance_after    NUMERIC(8,2) NOT NULL,
  reference_type   VARCHAR(30),
  reference_id     UUID,
  notes            TEXT,
  performed_by     UUID,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS comp_time_mov_employee_idx
  ON compensatory_time_movements (employee_id, created_at);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS comp_time_mov_reference_idx
  ON compensatory_time_movements (reference_type, reference_id);
