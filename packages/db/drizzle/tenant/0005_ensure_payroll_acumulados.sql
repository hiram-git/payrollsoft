-- Safety migration: ensure payroll_acumulados exists even if migration 0003
-- was tracked without executing (race condition / Drizzle edge case).
CREATE TABLE IF NOT EXISTS "payroll_acumulados" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payroll_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"concept_code" varchar(20) NOT NULL,
	"concept_name" varchar(255) NOT NULL,
	"concept_type" varchar(20) NOT NULL,
	"amount" varchar(20) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
