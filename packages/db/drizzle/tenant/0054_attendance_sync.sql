-- Background sync worker state per device + sync log.

CREATE TABLE IF NOT EXISTS attendance_sync_state (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id         uuid NOT NULL,
  status            varchar(20) NOT NULL DEFAULT 'stopped',
  interval_minutes  int NOT NULL DEFAULT 15,
  high_water_mark   bigint NOT NULL DEFAULT 0,
  last_run_at       timestamptz,
  last_success_at   timestamptz,
  last_error        text,
  punches_synced    int NOT NULL DEFAULT 0,
  days_consolidated int NOT NULL DEFAULT 0,
  auto_start        boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS attendance_sync_state_device_unique
  ON attendance_sync_state (device_id);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS attendance_sync_state_status_idx
  ON attendance_sync_state (status);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS attendance_sync_log (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id             uuid NOT NULL,
  started_at            timestamptz NOT NULL,
  finished_at           timestamptz,
  status                varchar(20) NOT NULL,
  punches_found         int NOT NULL DEFAULT 0,
  punches_consolidated  int NOT NULL DEFAULT 0,
  days_affected         int NOT NULL DEFAULT 0,
  high_water_before     bigint,
  high_water_after      bigint,
  error_message         text,
  created_at            timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS attendance_sync_log_device_idx
  ON attendance_sync_log (device_id, created_at);
