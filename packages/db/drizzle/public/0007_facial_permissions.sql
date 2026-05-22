-- Phase 10: Facial-recognition permission codes.
--
-- These permission codes are stored in the global catalog so the JWT
-- minting flow can stamp them into a user's token. The actual
-- tenant-level grant lives in the tenant migration 0034 (role_permissions
-- inserts for tenant_admin, hr, accountant, viewer).

INSERT INTO payroll_auth.permissions_catalog (code, module, action, scope, description, is_dangerous) VALUES
  ('facial:enroll',     'facial',    'enroll',  'tenant', 'Enroll an employee in facial recognition',  false),
  ('facial:read',       'facial',    'read',    'tenant', 'Read facial enrollments and marcaciones',   false),
  ('facial:mark',       'facial',    'mark',    'tenant', 'Submit a facial-recognition marcacion (kiosk)', false),
  ('facial:override',   'facial',    'override','tenant', 'Manually mark or correct a facial marcacion', true),
  ('facial:admin',      'facial',    'admin',   'tenant', 'Administer facial-recognition module (terminals, tokens)', true),
  ('terminals:read',    'terminals', 'read',    'tenant', 'Read facial kiosk terminals',               false),
  ('terminals:write',   'terminals', 'write',   'tenant', 'Create/update/delete facial kiosk terminals', true)
ON CONFLICT (code) DO UPDATE
  SET module       = EXCLUDED.module,
      action       = EXCLUDED.action,
      scope        = EXCLUDED.scope,
      description  = EXCLUDED.description,
      is_dangerous = EXCLUDED.is_dangerous;
