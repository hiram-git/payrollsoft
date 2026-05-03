-- Phase 1.2: per-tenant RBAC tables. Each tenant owns its own roles, permission
-- assignments, role inheritance graph and user-role mappings. Permission codes
-- reference payroll_auth.permissions_catalog (logical FK validated by the API).

CREATE TABLE IF NOT EXISTS roles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  code        varchar(50)  NOT NULL,
  name        varchar(120) NOT NULL,
  description text,
  is_system   boolean      NOT NULL DEFAULT false,
  created_at  timestamptz  NOT NULL DEFAULT now(),
  updated_at  timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT roles_code_unique UNIQUE (code),
  CONSTRAINT roles_code_format CHECK (code ~ '^[a-z][a-z0-9_]*$')
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id         uuid        NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_code varchar(80) NOT NULL,
  granted_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (role_id, permission_code)
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS role_permissions_code_idx
  ON role_permissions (permission_code);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS role_inheritance (
  parent_role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  child_role_id  uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY (parent_role_id, child_role_id),
  CONSTRAINT role_inheritance_no_self CHECK (parent_role_id <> child_role_id)
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS role_inheritance_child_idx
  ON role_inheritance (child_role_id);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS user_roles (
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id     uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role_id)
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS user_roles_role_idx
  ON user_roles (role_id);
--> statement-breakpoint

-- A monotonically increasing version per user, bumped whenever the user's
-- role assignments or any of their roles' permissions/inheritance change.
-- The JWT carries this number; a mismatch on auth forces a token refresh,
-- which is how we get near-instant permission revocation.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS permissions_version integer NOT NULL DEFAULT 1;
--> statement-breakpoint

-- A flag on the single tenant admin so the UI/API can enforce the
-- "one admin per tenant" rule. The legacy `role` column on users is kept
-- for now and will be dropped in a follow-up migration once all callers
-- consume the new role tables.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_tenant_admin boolean NOT NULL DEFAULT false;
