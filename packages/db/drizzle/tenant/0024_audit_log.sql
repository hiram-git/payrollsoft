-- Phase 1.3: per-tenant audit log. Captures privileged actions (RBAC changes,
-- payroll approvals, payslip emails, exports, etc.) so admins can answer
-- "who did what, when" without trawling application logs.
--
-- The user_id is intentionally not a FK: keeping audit rows after a user
-- record is removed is a feature, not a bug.

CREATE TABLE IF NOT EXISTS audit_log (
  id          bigserial PRIMARY KEY,
  user_id     uuid,
  user_email  varchar(255),
  action      varchar(80)  NOT NULL,
  entity      varchar(40),
  entity_id   varchar(64),
  payload     jsonb        NOT NULL DEFAULT '{}'::jsonb,
  ip_address  inet,
  user_agent  varchar(255),
  created_at  timestamptz  NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS audit_log_created_at_idx
  ON audit_log (created_at DESC);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS audit_log_user_id_idx
  ON audit_log (user_id);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS audit_log_action_idx
  ON audit_log (action);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS audit_log_entity_idx
  ON audit_log (entity, entity_id);
