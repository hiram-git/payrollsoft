-- ─────────────────────────────────────────────────────────────────────────
-- Treasury: per-bank ACH file format selection.
--
--   ach_format       → which fixed-width generator this bank's file uses
--                      ('banco_nacional', 'banco_general', 'mupa_v1', ...).
--   ach_entity_code  → 9-digit entity code that travels in the C/D/T detail
--                      record (distinct from the routing number).
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE banks
  ADD COLUMN IF NOT EXISTS ach_format VARCHAR(30);
--> statement-breakpoint

ALTER TABLE banks
  ADD COLUMN IF NOT EXISTS ach_entity_code VARCHAR(9);
