-- Phase 1.3 (central): bookkeeping tables for cross-tenant operations.
--
-- super_admin_audit records every action a super-admin takes — provisioning
-- a tenant, suspending one, impersonating, etc. The super_admin_id is FK'd
-- to preserve referential integrity (super admins are not deleted, only
-- deactivated), but the tenant_id is nullable since some actions (e.g.
-- creating a new super admin) have no tenant context.
--
-- tenant_provisioning tracks the asynchronous schema-creation job. The
-- POST /superadmin/tenants endpoint inserts a row in 'pending' state, the
-- worker flips it to 'running' and finally to 'done' or 'failed'.

CREATE TABLE IF NOT EXISTS payroll_auth.super_admin_audit (
  id              bigserial PRIMARY KEY,
  super_admin_id  uuid REFERENCES payroll_auth.super_admins(id) ON DELETE SET NULL,
  tenant_id       uuid REFERENCES payroll_auth.tenants(id)      ON DELETE SET NULL,
  action          varchar(80)  NOT NULL,
  payload         jsonb        NOT NULL DEFAULT '{}'::jsonb,
  ip_address      inet,
  user_agent      varchar(255),
  created_at      timestamptz  NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS super_admin_audit_created_at_idx
  ON payroll_auth.super_admin_audit (created_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS super_admin_audit_tenant_idx
  ON payroll_auth.super_admin_audit (tenant_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS super_admin_audit_action_idx
  ON payroll_auth.super_admin_audit (action);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS payroll_auth.tenant_provisioning (
  tenant_id   uuid PRIMARY KEY REFERENCES payroll_auth.tenants(id) ON DELETE CASCADE,
  state       varchar(20)  NOT NULL DEFAULT 'pending',
  error       text,
  started_at  timestamptz,
  finished_at timestamptz,
  CONSTRAINT tenant_provisioning_state_check
    CHECK (state IN ('pending','running','done','failed'))
);
