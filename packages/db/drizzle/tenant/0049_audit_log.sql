-- Centralized audit log for all entity changes.
CREATE TABLE IF NOT EXISTS audit_log (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid,
  user_name   varchar(255),
  action      varchar(30)  NOT NULL,
  entity      varchar(60)  NOT NULL,
  entity_id   varchar(255),
  changes     jsonb        NOT NULL DEFAULT '{}',
  ip_address  varchar(45),
  created_at  timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_log_entity_idx ON audit_log(entity, entity_id);
CREATE INDEX IF NOT EXISTS audit_log_user_idx ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS audit_log_created_idx ON audit_log(created_at DESC);
