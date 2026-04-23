CREATE TABLE "cuentas_contables" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "code" varchar(20) NOT NULL,
  "name" varchar(255) NOT NULL,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "cuentas_contables_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "concepts" ADD COLUMN IF NOT EXISTS "cuenta_contable_id" uuid;
