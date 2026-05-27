-- Phase 0.1: introduce the dedicated `payroll_auth` schema for cross-tenant
-- authentication & authorization tables. Idempotent: works on a fresh install
-- (creates tables) and on an existing one (moves them from `public`).

CREATE SCHEMA IF NOT EXISTS payroll_auth;
--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'tenants'
  )
  AND NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'payroll_auth' AND table_name = 'tenants'
  ) THEN
    EXECUTE 'ALTER TABLE public.tenants SET SCHEMA payroll_auth';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'super_admins'
  )
  AND NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'payroll_auth' AND table_name = 'super_admins'
  ) THEN
    EXECUTE 'ALTER TABLE public.super_admins SET SCHEMA payroll_auth';
  END IF;
END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS payroll_auth.super_admins (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  email         varchar(255) NOT NULL,
  password_hash varchar(255) NOT NULL,
  name          varchar(255) NOT NULL,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamp NOT NULL DEFAULT now(),
  CONSTRAINT super_admins_email_unique UNIQUE (email)
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS payroll_auth.tenants (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  slug            varchar(50) NOT NULL,
  name            varchar(255) NOT NULL,
  database_schema varchar(100) NOT NULL,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamp NOT NULL DEFAULT now(),
  updated_at      timestamp NOT NULL DEFAULT now(),
  CONSTRAINT tenants_slug_unique UNIQUE (slug)
);
--> statement-breakpoint

-- New columns introduced by the multi-tenant RBAC plan
ALTER TABLE payroll_auth.tenants
  ADD COLUMN IF NOT EXISTS status        varchar(20)  NOT NULL DEFAULT 'PROVISIONING';
--> statement-breakpoint
ALTER TABLE payroll_auth.tenants
  ADD COLUMN IF NOT EXISTS contact_email varchar(255);
--> statement-breakpoint
ALTER TABLE payroll_auth.tenants
  ADD COLUMN IF NOT EXISTS metadata      jsonb        NOT NULL DEFAULT '{}'::jsonb;
--> statement-breakpoint
ALTER TABLE payroll_auth.tenants
  ADD COLUMN IF NOT EXISTS archived_at   timestamp;
--> statement-breakpoint

-- Backfill `status` for rows migrated from the legacy `is_active`-only model
UPDATE payroll_auth.tenants
   SET status = CASE WHEN is_active THEN 'ACTIVE' ELSE 'SUSPENDED' END
 WHERE status = 'PROVISIONING';
--> statement-breakpoint

ALTER TABLE payroll_auth.tenants
  DROP CONSTRAINT IF EXISTS tenants_status_check;
--> statement-breakpoint
ALTER TABLE payroll_auth.tenants
  ADD  CONSTRAINT tenants_status_check
  CHECK (status IN ('PROVISIONING','ACTIVE','SUSPENDED','ARCHIVED'));
--> statement-breakpoint

-- Slug shape: lowercase, digits, dash/underscore, 3..50 chars, must start
-- with alphanumeric. Enforced both at the API layer and here as a safety net.
ALTER TABLE payroll_auth.tenants
  DROP CONSTRAINT IF EXISTS tenants_slug_format_check;
--> statement-breakpoint
ALTER TABLE payroll_auth.tenants
  ADD  CONSTRAINT tenants_slug_format_check
  CHECK (slug ~ '^[a-z0-9][a-z0-9_-]{2,49}$');
