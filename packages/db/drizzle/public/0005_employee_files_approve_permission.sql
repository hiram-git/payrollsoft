-- Permiso para aprobar/rechazar expedientes. El workflow se carga
-- por configuración tenant-side (employee_file_approval_rules), pero
-- el código del permiso es global porque vive en payroll_auth.

INSERT INTO payroll_auth.permissions_catalog (code, module, action, scope, description, is_dangerous) VALUES
  ('employee_files:approve', 'employee_files', 'approve', 'tenant', 'Approve or reject employee files', false)
ON CONFLICT (code) DO UPDATE
  SET module       = EXCLUDED.module,
      action       = EXCLUDED.action,
      scope        = EXCLUDED.scope,
      description  = EXCLUDED.description,
      is_dangerous = EXCLUDED.is_dangerous;
