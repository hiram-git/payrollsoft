-- ─────────────────────────────────────────────────────────────────────────
-- Treasury: ACH line snapshots can reference a creditor, not only an employee.
--
--   creditor_id      → the provider when beneficiary_type = 'creditor'
--   beneficiary_type → 'employee' | 'creditor'
--
-- employee_id stays nullable; for creditor lines it is null and creditor_id
-- is set instead.
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE treasury_ach_lines
  ADD COLUMN IF NOT EXISTS creditor_id uuid;
--> statement-breakpoint

ALTER TABLE treasury_ach_lines
  ADD COLUMN IF NOT EXISTS beneficiary_type VARCHAR(20) NOT NULL DEFAULT 'employee';
