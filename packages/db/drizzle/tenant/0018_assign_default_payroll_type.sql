-- Migration 0018: Assign default payroll type to employees that have none.
--
-- Idempotent: ON CONFLICT DO NOTHING means re-running is safe.
-- Reversible: only inserts rows; to revert, delete from employee_payroll_types
--   WHERE payroll_type_id = (SELECT id FROM concept_payroll_types ORDER BY sort_order LIMIT 1)
--   AND employee_id NOT IN (SELECT employee_id FROM employee_payroll_types WHERE ... prior run).
--   In practice, dropping the column or truncating employee_payroll_types is the rollback.
--
-- WARNING: This migration assumes concept_payroll_types has at least one row.
-- If the table is empty no rows are inserted and no error is raised.

INSERT INTO "employee_payroll_types" ("employee_id", "payroll_type_id")
SELECT e.id, pt.id
FROM "employees" e
CROSS JOIN LATERAL (
  SELECT id FROM "concept_payroll_types" ORDER BY sort_order ASC LIMIT 1
) pt
WHERE e.is_active = true
  AND NOT EXISTS (
    SELECT 1
    FROM "employee_payroll_types" ept
    WHERE ept.employee_id = e.id
  )
ON CONFLICT DO NOTHING;
