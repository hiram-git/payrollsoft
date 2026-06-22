-- Permissions for the time-balance module.
--   time_balance:read     — view employee time balances and movements
--   time_balance:write    — manual adjustments, run renewal, manage delegations
--   time_balance:override — force a debit that would leave the balance negative
INSERT INTO payroll_auth.permissions_catalog (code, module, action, scope, description, is_dangerous) VALUES
  ('time_balance:read',     'time_balance', 'read',     'tenant', 'Ver saldos de tiempo y movimientos de los colaboradores.', false),
  ('time_balance:write',    'time_balance', 'write',    'tenant', 'Ajustes manuales de saldo, renovación anual y delegaciones.', false),
  ('time_balance:override', 'time_balance', 'override', 'tenant', 'Forzar un débito que deja el saldo en negativo.', true)
ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint

INSERT INTO payroll_auth.system_role_permissions (role_code, permission_code)
VALUES
  ('tenant_admin', 'time_balance:read'),
  ('tenant_admin', 'time_balance:write'),
  ('tenant_admin', 'time_balance:override'),
  ('hr', 'time_balance:read'),
  ('hr', 'time_balance:write'),
  ('hr', 'time_balance:override')
ON CONFLICT DO NOTHING;
