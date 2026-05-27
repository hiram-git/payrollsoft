-- Split sync into two independent workers: ingestion (per-device) + consolidation (per-tenant).
-- The v1 tables from 0054 are dropped (never deployed with data).

DROP TABLE IF EXISTS attendance_sync_log;
--> statement-breakpoint
DROP TABLE IF EXISTS attendance_sync_state;
--> statement-breakpoint

-- Ingestion worker state: one row per device
CREATE TABLE IF NOT EXISTS attendance_ingestion_state (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id         uuid NOT NULL,
  status            varchar(20) NOT NULL DEFAULT 'stopped',
  interval_minutes  int NOT NULL DEFAULT 5,
  high_water_mark   timestamptz,
  last_file_hash    varchar(64),
  last_run_at       timestamptz,
  last_success_at   timestamptz,
  last_error        text,
  punches_ingested  int NOT NULL DEFAULT 0,
  auto_start        boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS att_ingestion_state_device_uq
  ON attendance_ingestion_state (device_id);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS att_ingestion_state_status_idx
  ON attendance_ingestion_state (status);
--> statement-breakpoint

-- Ingestion log: one row per cycle per device
CREATE TABLE IF NOT EXISTS attendance_ingestion_log (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id         uuid NOT NULL,
  started_at        timestamptz NOT NULL,
  finished_at       timestamptz,
  status            varchar(20) NOT NULL,
  punches_found     int NOT NULL DEFAULT 0,
  punches_new       int NOT NULL DEFAULT 0,
  punches_skipped   int NOT NULL DEFAULT 0,
  unknown_employees int NOT NULL DEFAULT 0,
  high_water_before timestamptz,
  high_water_after  timestamptz,
  error_message     text,
  created_at        timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS att_ingestion_log_device_idx
  ON attendance_ingestion_log (device_id, created_at);
--> statement-breakpoint

-- Consolidation worker state: singleton per tenant
CREATE TABLE IF NOT EXISTS attendance_consolidation_state (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status            varchar(20) NOT NULL DEFAULT 'stopped',
  interval_minutes  int NOT NULL DEFAULT 15,
  high_water_mark   bigint NOT NULL DEFAULT 0,
  last_run_at       timestamptz,
  last_success_at   timestamptz,
  last_error        text,
  days_consolidated int NOT NULL DEFAULT 0,
  auto_start        boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

-- Consolidation log
CREATE TABLE IF NOT EXISTS attendance_consolidation_log (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at            timestamptz NOT NULL,
  finished_at           timestamptz,
  status                varchar(20) NOT NULL,
  punches_found         int NOT NULL DEFAULT 0,
  days_affected         int NOT NULL DEFAULT 0,
  employees_processed   int NOT NULL DEFAULT 0,
  employees_absent      int NOT NULL DEFAULT 0,
  high_water_before     bigint,
  high_water_after      bigint,
  error_message         text,
  created_at            timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS att_consolidation_log_created_idx
  ON attendance_consolidation_log (created_at);
--> statement-breakpoint

-- Add sync_source_path to attendance_devices
ALTER TABLE attendance_devices
  ADD COLUMN IF NOT EXISTS sync_source_path varchar(500);
