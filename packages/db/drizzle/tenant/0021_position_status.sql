-- Migration 0021: Position lifecycle status.
--
-- Adds `status` to positions ('en_uso' | 'vacante'). Default 'vacante'
-- so newly created positions are open to be filled, and existing rows
-- get the same default — admins can mark an occupied one explicitly.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS — re-running is safe.

ALTER TABLE "positions"
  ADD COLUMN IF NOT EXISTS "status" varchar(20) NOT NULL DEFAULT 'vacante';
