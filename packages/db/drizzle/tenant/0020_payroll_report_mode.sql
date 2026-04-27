-- Migration 0020: Per-tenant Planilla PDF lifecycle mode.
--
-- Adds `payroll_report_mode` to company_config. Two modes:
--   'on_demand'    — render the PDF every time a user clicks Descargar.
--                    Zero storage cost; works without any object-storage
--                    backend (suitable for local installs and small tenants).
--   'file_storage' — render once and persist to Cloudflare R2 (or any
--                    S3-compatible bucket). Subsequent downloads stream
--                    the stored object, so big payrolls feel instant.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS — re-running is safe.
-- Non-destructive: existing columns (incl. pdf_path) are not touched.

ALTER TABLE "company_config"
  ADD COLUMN IF NOT EXISTS "payroll_report_mode" varchar(20) NOT NULL DEFAULT 'on_demand';
