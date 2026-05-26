-- Add users:write permission (used by portal credential management).
INSERT INTO payroll_auth.permissions_catalog (code, module, action, scope, description, is_dangerous) VALUES
  ('users:write', 'users', 'write', 'tenant', 'Manage user credentials, portal access, and password resets.', false)
ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint

INSERT INTO payroll_auth.system_role_permissions (role_code, permission_code)
VALUES ('tenant_admin', 'users:write')
ON CONFLICT DO NOTHING;
