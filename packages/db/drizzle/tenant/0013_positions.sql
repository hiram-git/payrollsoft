CREATE TABLE "positions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "code" varchar(20) NOT NULL,
  "name" varchar(255) NOT NULL,
  "salary" varchar(20) NOT NULL DEFAULT '0',
  "cargo_id" uuid,
  "departamento_id" uuid,
  "funcion_id" uuid,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "positions_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "position_id" uuid;
