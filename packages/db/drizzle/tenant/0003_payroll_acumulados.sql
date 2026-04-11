CREATE TABLE "payroll_acumulados" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payroll_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"concept_code" varchar(20) NOT NULL,
	"concept_name" varchar(255) NOT NULL,
	"concept_type" varchar(20) NOT NULL,
	"amount" varchar(20) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payrolls" ALTER COLUMN "status" SET DEFAULT 'created';
