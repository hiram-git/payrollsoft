-- Migration 0019: Payroll report state machine.
--
-- Tracks PDF generation status per payroll so the UI can surface a
-- Descargar / Regenerar button pair instead of always re-rendering on click.
--
-- Idempotent: guarded by IF NOT EXISTS so re-running is safe.

CREATE TABLE IF NOT EXISTS "payroll_reports" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "payroll_id" uuid NOT NULL UNIQUE,
  "status" varchar(20) NOT NULL DEFAULT 'not_generated',
  "pdf_path" text,
  "generated_at" timestamptz,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "generated_by" uuid
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payroll_reports_payroll_id_idx" ON "payroll_reports" ("payroll_id");
