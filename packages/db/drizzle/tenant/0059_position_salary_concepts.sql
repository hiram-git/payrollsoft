-- ─────────────────────────────────────────────────────────────────────────
-- Positions: additional public-sector salary concepts.
--
-- Adds amount columns for sobresueldo (overtime_amount) and gastos de
-- representación (representation_amount), plus a budget item (partida) per
-- concept so each can be charged to a different partida presupuestaria:
--   budget_item_id                  → base salary (already existed)
--   overtime_budget_item_id         → sobresueldo
--   representation_budget_item_id   → gastos de representación
--   thirteenth_month_budget_item_id → décimo tercer mes
--
-- The payroll engine does NOT consume these yet; their fiscal treatment is
-- pending validation with a Panamanian payroll specialist.
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE positions
  ADD COLUMN IF NOT EXISTS overtime_amount VARCHAR(20) NOT NULL DEFAULT '0';
--> statement-breakpoint

ALTER TABLE positions
  ADD COLUMN IF NOT EXISTS representation_amount VARCHAR(20) NOT NULL DEFAULT '0';
--> statement-breakpoint

ALTER TABLE positions
  ADD COLUMN IF NOT EXISTS overtime_budget_item_id UUID;
--> statement-breakpoint

ALTER TABLE positions
  ADD COLUMN IF NOT EXISTS representation_budget_item_id UUID;
--> statement-breakpoint

ALTER TABLE positions
  ADD COLUMN IF NOT EXISTS thirteenth_month_budget_item_id UUID;
