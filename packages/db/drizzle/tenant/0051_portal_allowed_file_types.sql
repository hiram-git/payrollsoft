-- Per-employee filter: which file types/subtypes an employee can request
-- from the portal. When no rows exist for an employee, all types are allowed.
CREATE TABLE IF NOT EXISTS portal_allowed_file_types (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id   uuid        NOT NULL,
  type_id       integer     NOT NULL,
  subtype_id    integer,
  granted_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, type_id, subtype_id)
);

CREATE INDEX IF NOT EXISTS portal_allowed_ft_employee_idx
  ON portal_allowed_file_types(employee_id);
