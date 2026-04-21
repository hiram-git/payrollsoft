CREATE TABLE "partidas_presupuestarias" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "code" varchar(20) NOT NULL,
  "name" varchar(255) NOT NULL,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "partidas_presupuestarias_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "positions" ADD COLUMN IF NOT EXISTS "partida_id" uuid;
