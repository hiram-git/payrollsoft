-- Phase 9: permisos del módulo "Expedientes de empleados".
--
-- Tres permisos: read / write / delete (en línea con custom-fields y
-- el resto del catálogo). Mismo formato `^[a-z_]+:[a-z_]+$` exigido
-- por el CHECK de `permissions_catalog`, de ahí el snake-case.

INSERT INTO payroll_auth.permissions_catalog (code, module, action, scope, description, is_dangerous) VALUES
  ('employee_files:read',   'employee_files', 'read',   'tenant', 'List and view employee files',         false),
  ('employee_files:write',  'employee_files', 'write',  'tenant', 'Create or edit employee files',        false),
  ('employee_files:delete', 'employee_files', 'delete', 'tenant', 'Delete employee files and attachments', true)
ON CONFLICT (code) DO UPDATE
  SET module       = EXCLUDED.module,
      action       = EXCLUDED.action,
      scope        = EXCLUDED.scope,
      description  = EXCLUDED.description,
      is_dangerous = EXCLUDED.is_dangerous;
