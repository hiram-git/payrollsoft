-- Migration 0009: Creditors catalog + creditorId on loans

CREATE TABLE "creditors" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "code" varchar(20) NOT NULL,
  "name" varchar(255) NOT NULL,
  "description" text,
  "concept_code" varchar(20),
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "creditors_code_unique" UNIQUE("code")
);
--> statement-breakpoint

ALTER TABLE "loans" ADD COLUMN "creditor_id" uuid;
