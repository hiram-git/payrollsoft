-- ─────────────────────────────────────────────────────────────────────────
-- Move the job function from the position to the employee.
--
-- The function is an attribute of the employee, not of the position: two
-- employees in the same position may perform different functions. The
-- employees.job_function_id column already exists; this migration backfills
-- it from each employee's assigned position and then drops the now-redundant
-- positions.job_function_id column.
-- ─────────────────────────────────────────────────────────────────────────

-- Backfill: employees inherit the function from their current position when
-- they don't already have one set.
UPDATE employees e
SET job_function_id = p.job_function_id
FROM positions p
WHERE e.position_id = p.id
  AND e.job_function_id IS NULL
  AND p.job_function_id IS NOT NULL;
--> statement-breakpoint

ALTER TABLE positions DROP COLUMN IF EXISTS job_function_id;
