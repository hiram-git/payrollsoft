-- ─────────────────────────────────────────────────────────────────────────
-- Employees: new personal flags (Phase 2.D).
--
--   has_own_disability          → enables the employee's own-disability time
--                                 balance (unblocks the hook in time-balance)
--   requires_attendance_marking → does this employee clock in/out? (default
--                                 true; false for directors / exempt staff)
--   can_read / can_write        → literacy flags
--
-- The photo and scanned_id (base64) columns already exist; no schema change
-- is needed for them — the form simply starts populating them.
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS has_own_disability BOOLEAN NOT NULL DEFAULT false;
--> statement-breakpoint

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS requires_attendance_marking BOOLEAN NOT NULL DEFAULT true;
--> statement-breakpoint

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS can_read BOOLEAN NOT NULL DEFAULT false;
--> statement-breakpoint

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS can_write BOOLEAN NOT NULL DEFAULT false;
