-- Granular module access control for the employee portal.
-- Each row enables/disables a specific portal module for an employee.
CREATE TABLE IF NOT EXISTS portal_access (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  module varchar(30) NOT NULL,
  is_enabled boolean NOT NULL DEFAULT true,
  granted_by uuid,
  granted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, module)
);

CREATE INDEX IF NOT EXISTS portal_access_employee_idx ON portal_access(employee_id);

-- Seed default modules for all employees that already have credentials
INSERT INTO portal_access (employee_id, module, is_enabled)
SELECT ec.employee_id, m.module, true
FROM employee_credentials ec
CROSS JOIN (VALUES ('requests'), ('attendance'), ('vacations')) AS m(module)
ON CONFLICT (employee_id, module) DO NOTHING;
