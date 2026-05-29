-- Permission to register and manage approval delegations.
INSERT INTO payroll_auth.permissions_catalog (code, module, action, scope, description, is_dangerous) VALUES
  ('approvals:delegate', 'approvals', 'delegate', 'tenant', 'Registrar y gestionar delegaciones temporales de aprobación.', false)
ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint

INSERT INTO payroll_auth.system_role_permissions (role_code, permission_code)
VALUES
  ('tenant_admin', 'approvals:delegate'),
  ('hr', 'approvals:delegate')
ON CONFLICT DO NOTHING;
