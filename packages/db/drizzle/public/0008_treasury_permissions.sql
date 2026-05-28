-- Permisos del módulo de tesorería.
--
--   treasury:read   — ver chequeras, corridas, cheques y batches ACH
--   treasury:write  — crear corridas, asignar cheques, emitir ACH
--   treasury:void   — anular cheques emitidos (operación sensible)
--   treasury:print  — generar PDFs/Excel para imprimir cheques
--   banks:read      — leer catálogo de bancos
--   banks:write     — administrar catálogo de bancos
--
-- treasury:void se separa porque permite reciclar un número de cheque
-- que ya fue impreso — debe estar limitado a roles muy específicos.

INSERT INTO payroll_auth.permissions_catalog (code, module, action, scope, description, is_dangerous) VALUES
  ('treasury:read',  'treasury', 'read',  'tenant', 'Ver corridas de pago, cheques emitidos y lotes ACH generados.', false),
  ('treasury:write', 'treasury', 'write', 'tenant', 'Crear corridas, asignar cheques, generar TXT ACH.',              false),
  ('treasury:void',  'treasury', 'void',  'tenant', 'Anular cheques emitidos. Operación auditada y restringida.',     true),
  ('treasury:print', 'treasury', 'print', 'tenant', 'Generar PDF/Excel imprimibles de cheques.',                       false),
  ('banks:read',     'banks',    'read',  'tenant', 'Leer catálogo de bancos.',                                        false),
  ('banks:write',    'banks',    'write', 'tenant', 'Administrar el catálogo de bancos del país.',                     false)
ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint

-- Asignar a los roles globales del sistema.
INSERT INTO payroll_auth.system_role_permissions (role_code, permission_code)
SELECT 'tenant_admin', code FROM payroll_auth.permissions_catalog
 WHERE code IN ('treasury:read','treasury:write','treasury:void','treasury:print','banks:read','banks:write')
ON CONFLICT DO NOTHING;
--> statement-breakpoint

INSERT INTO payroll_auth.system_role_permissions (role_code, permission_code)
SELECT 'accountant', code FROM payroll_auth.permissions_catalog
 WHERE code IN ('treasury:read','treasury:write','treasury:print','banks:read')
ON CONFLICT DO NOTHING;
--> statement-breakpoint

INSERT INTO payroll_auth.system_role_permissions (role_code, permission_code)
SELECT 'viewer', code FROM payroll_auth.permissions_catalog
 WHERE code IN ('treasury:read','banks:read')
ON CONFLICT DO NOTHING;
