-- Add status and shift tracking to attendance_records.
--
-- `status` classifies the day: present | late | absent | partial | holiday
-- `shift_id` records which shift was used for the calculation so the
-- consolidator can be re-run with a different shift if needed.

ALTER TABLE attendance_records
  ADD COLUMN IF NOT EXISTS status varchar(20) NOT NULL DEFAULT 'present',
  ADD COLUMN IF NOT EXISTS shift_id uuid;
--> statement-breakpoint

-- Default existing records to 'present' (they were created manually
-- or by import — no status was set before).
-- No-op if the column already existed with the default.
