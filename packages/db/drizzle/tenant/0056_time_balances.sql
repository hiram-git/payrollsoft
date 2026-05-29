-- ─────────────────────────────────────────────────────────────────────────
-- Time balances: pure-ledger model for employee time accounts.
--
-- Replaces the earlier snapshot-based compensatory_time_* tables. A balance
-- is an account for one (employee, balance_type, year). The current balance
-- is NEVER stored — it is computed as SUM(amount_minutes) over its movements.
--
--   balance_type ∈ compensatory | disability | family_disability
--   amount_minutes  > 0  → credit (initialization, overtime, adjustment+)
--                   < 0  → debit  (absence, tardiness, permission, adjustment-)
--
-- 144 hours = 8640 minutes is the standard annual initialization.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS time_balances (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id     UUID NOT NULL,
  balance_type    VARCHAR(30) NOT NULL,
  year            INTEGER NOT NULL,
  initial_minutes INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS time_balances_emp_type_year_uq
  ON time_balances (employee_id, balance_type, year);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS time_balances_employee_idx
  ON time_balances (employee_id);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS time_balance_movements (
  id              BIGSERIAL PRIMARY KEY,
  balance_id      UUID NOT NULL,
  movement_type   VARCHAR(30) NOT NULL,
  amount_minutes  INTEGER NOT NULL,
  source_type     VARCHAR(40) NOT NULL DEFAULT 'manual',
  source_id       UUID,
  effective_date  DATE NOT NULL DEFAULT CURRENT_DATE,
  description     TEXT,
  created_by      UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS time_balance_movements_balance_idx
  ON time_balance_movements (balance_id, created_at);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS time_balance_movements_source_idx
  ON time_balance_movements (source_type, source_id);
--> statement-breakpoint

-- ── Migrate data from the old snapshot tables, if present ──────────────────
-- Each old balance row becomes a new time_balance with an initialization
-- movement equal to its net (earned - used - reserved) minutes. Old `pool`
-- maps 1:1 to new `balance_type`. Hours → minutes (×60).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'compensatory_time_balances'
  ) THEN
    -- Create the time_balances rows
    INSERT INTO time_balances (employee_id, balance_type, year, initial_minutes, created_at)
    SELECT b.employee_id, b.pool, b.year,
           ROUND(b.earned * 60)::int,
           b.updated_at
    FROM compensatory_time_balances b
    ON CONFLICT (employee_id, balance_type, year) DO NOTHING;

    -- Seed one consolidated movement per migrated balance with the net value
    INSERT INTO time_balance_movements
      (balance_id, movement_type, amount_minutes, source_type, effective_date, description, created_at)
    SELECT tb.id, 'initialization',
           ROUND((b.earned - b.used - b.reserved) * 60)::int,
           'system_initialization',
           make_date(b.year, 1, 1),
           'Migrado desde compensatory_time_balances',
           b.updated_at
    FROM compensatory_time_balances b
    JOIN time_balances tb
      ON tb.employee_id = b.employee_id
     AND tb.balance_type = b.pool
     AND tb.year = b.year;
  END IF;
END $$;
--> statement-breakpoint

DROP TABLE IF EXISTS compensatory_time_movements;
--> statement-breakpoint

DROP TABLE IF EXISTS compensatory_time_balances;
