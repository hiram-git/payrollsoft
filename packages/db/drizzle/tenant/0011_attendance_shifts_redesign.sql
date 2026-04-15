-- Redesign shifts for 4-point attendance (entrada, salida almuerzo, entrada almuerzo, salida)
ALTER TABLE "shifts"
  ADD COLUMN "entry_time" time,
  ADD COLUMN "lunch_start_time" time,
  ADD COLUMN "lunch_end_time" time,
  ADD COLUMN "exit_time" time,
  ADD COLUMN "entry_tolerance_before" integer NOT NULL DEFAULT 0,
  ADD COLUMN "entry_tolerance_after" integer NOT NULL DEFAULT 0,
  ADD COLUMN "lunch_start_tolerance_before" integer NOT NULL DEFAULT 0,
  ADD COLUMN "lunch_start_tolerance_after" integer NOT NULL DEFAULT 0,
  ADD COLUMN "lunch_end_tolerance_before" integer NOT NULL DEFAULT 0,
  ADD COLUMN "lunch_end_tolerance_after" integer NOT NULL DEFAULT 0,
  ADD COLUMN "exit_tolerance_before" integer NOT NULL DEFAULT 0,
  ADD COLUMN "exit_tolerance_after" integer NOT NULL DEFAULT 0,
  ADD COLUMN "updated_at" timestamp NOT NULL DEFAULT now();

UPDATE "shifts" SET "entry_time" = "start_time", "exit_time" = "end_time";

ALTER TABLE "shifts" ALTER COLUMN "entry_time" SET NOT NULL;
ALTER TABLE "shifts" ALTER COLUMN "exit_time" SET NOT NULL;

ALTER TABLE "shifts"
  DROP COLUMN "start_time",
  DROP COLUMN "end_time",
  DROP COLUMN "lunch_minutes";
