-- Annual renewal worker state + log for time balances.
-- Singleton-per-tenant state; the worker ticks every interval_minutes and
-- opens the new year's balances once the date reaches (run_month, run_day)
-- and last_renewed_year is behind the current year. Idempotent per year.

CREATE TABLE IF NOT EXISTS time_balance_renewal_state (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status              VARCHAR(20) NOT NULL DEFAULT 'stopped',
  interval_minutes    INTEGER NOT NULL DEFAULT 1440,
  run_month           SMALLINT NOT NULL DEFAULT 1,
  run_day             SMALLINT NOT NULL DEFAULT 1,
  last_renewed_year   INTEGER,
  last_run_at         TIMESTAMPTZ,
  last_success_at     TIMESTAMPTZ,
  last_error          TEXT,
  years_renewed       INTEGER NOT NULL DEFAULT 0,
  auto_start          BOOLEAN NOT NULL DEFAULT false,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS time_balance_renewal_log (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at                  TIMESTAMPTZ NOT NULL,
  finished_at                 TIMESTAMPTZ,
  status                      VARCHAR(20) NOT NULL,
  year                        INTEGER,
  employees_processed         INTEGER NOT NULL DEFAULT 0,
  compensatory_created        INTEGER NOT NULL DEFAULT 0,
  family_disability_created   INTEGER NOT NULL DEFAULT 0,
  trigger                     VARCHAR(20) NOT NULL DEFAULT 'worker',
  error_message               TEXT,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS time_balance_renewal_log_created_idx
  ON time_balance_renewal_log (created_at);
