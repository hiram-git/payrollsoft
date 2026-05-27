-- Permission for controlling the attendance sync worker.
INSERT INTO payroll_auth.permissions_catalog (code, module, action, scope, description, is_dangerous) VALUES
  ('attendance:sync', 'attendance', 'sync', 'tenant', 'Start, stop, and monitor the attendance synchronization worker.', false)
ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint

INSERT INTO payroll_auth.system_role_permissions (role_code, permission_code)
VALUES
  ('tenant_admin', 'attendance:sync'),
  ('hr', 'attendance:sync')
ON CONFLICT DO NOTHING;
