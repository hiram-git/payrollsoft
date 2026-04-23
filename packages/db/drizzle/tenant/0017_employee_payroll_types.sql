-- Seed 4 baseline organizational payroll types (idempotent)
INSERT INTO "concept_payroll_types" ("id", "code", "name", "sort_order")
VALUES
  (gen_random_uuid(), 'REGULAR',                 'Nómina Regular',          1),
  (gen_random_uuid(), 'TRANSITORIA',             'Nómina Transitoria',      2),
  (gen_random_uuid(), 'CONTINGENCIA',            'Nómina Contingencia',     3),
  (gen_random_uuid(), 'SERVICIOS_PROFESIONALES', 'Servicios Profesionales', 4)
ON CONFLICT (code) DO NOTHING;

--> statement-breakpoint
-- Many-to-many pivot: employee ↔ payroll type
CREATE TABLE IF NOT EXISTS "employee_payroll_types" (
  "employee_id"      uuid NOT NULL,
  "payroll_type_id"  uuid NOT NULL,
  PRIMARY KEY ("employee_id", "payroll_type_id")
);

--> statement-breakpoint
-- Organizational type on payroll runs
ALTER TABLE "payrolls" ADD COLUMN IF NOT EXISTS "payroll_type_id" uuid;

--> statement-breakpoint
-- Auto-assign all existing active employees to REGULAR so no employee is orphaned
INSERT INTO "employee_payroll_types" ("employee_id", "payroll_type_id")
SELECT e.id, pt.id
FROM "employees" e
CROSS JOIN "concept_payroll_types" pt
WHERE pt.code = 'REGULAR'
  AND e.is_active = true
ON CONFLICT DO NOTHING;
