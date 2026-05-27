-- Phase 7.1: weekday metadata on shifts + work_calendar table
--
-- Two changes:
--
-- 1. shifts.weekdays — ISO weekday list (1=Mon..7=Sun) telling the
--    calendar generator which days a shift applies to. Default '{1,2,3,4,5}'
--    keeps the existing Monday-Friday assumption for legacy rows.
--
-- 2. work_calendar — one row per calendar date, optionally bound to a
--    shift. The /config/calendars wizard inserts rows here when an admin
--    initialises a year (or set of months) against the chosen shifts.
--    UNIQUE(date) keeps the calendar single-source-of-truth per day; a
--    re-initialisation upserts.

ALTER TABLE shifts
  ADD COLUMN IF NOT EXISTS weekdays integer[] NOT NULL DEFAULT '{1,2,3,4,5}';
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS work_calendar (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  date        date          NOT NULL,
  shift_id    uuid REFERENCES shifts(id) ON DELETE SET NULL,
  is_workday  boolean       NOT NULL DEFAULT true,
  notes       text,
  created_at  timestamptz   NOT NULL DEFAULT now(),
  updated_at  timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT work_calendar_date_unique UNIQUE (date)
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS work_calendar_date_idx ON work_calendar (date);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS work_calendar_shift_idx ON work_calendar (shift_id);
