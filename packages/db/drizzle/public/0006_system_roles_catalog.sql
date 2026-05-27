-- Catálogo global de roles del sistema.
--
-- El superadmin crea/edita roles en `payroll_auth.system_roles_catalog`
-- (con su set de permisos en `payroll_auth.system_role_permissions`)
-- y la API los propaga a cada tenant — upsert por `code` en la tabla
-- `roles` del tenant, preservando user_roles asignados.
--
-- Esto convierte SYSTEM_ROLES (hardcoded en `@payroll/types`) en un
-- bootstrap inicial: la fuente de verdad pasa a ser esta tabla. Cada
-- vez que se provisione un tenant nuevo, los roles de aquí (más los
-- de SYSTEM_ROLES) se aplican; las ediciones del superadmin se
-- propagan automáticamente.

CREATE TABLE IF NOT EXISTS payroll_auth.system_roles_catalog (
  code         varchar(50) PRIMARY KEY
    CONSTRAINT system_roles_catalog_code_format
    CHECK (code ~ '^[a-z][a-z0-9_]{1,49}$'),
  name         varchar(120) NOT NULL,
  description  text,
  is_dangerous boolean      NOT NULL DEFAULT false,
  created_at   timestamptz  NOT NULL DEFAULT now(),
  updated_at   timestamptz  NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS payroll_auth.system_role_permissions (
  role_code       varchar(50) NOT NULL
    REFERENCES payroll_auth.system_roles_catalog(code) ON DELETE CASCADE,
  permission_code varchar(80) NOT NULL
    REFERENCES payroll_auth.permissions_catalog(code)  ON DELETE CASCADE,
  granted_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (role_code, permission_code)
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS system_role_permissions_perm_idx
  ON payroll_auth.system_role_permissions (permission_code);
--> statement-breakpoint

-- Seed inicial: insertar los cuatro roles base con sus permisos,
-- usando la misma definición que SYSTEM_ROLES en @payroll/types.
-- Idempotente — re-correr la migración no pisa cambios manuales.

INSERT INTO payroll_auth.system_roles_catalog (code, name, description) VALUES
  ('tenant_admin', 'Administrador', 'Acceso total a la empresa: usuarios, roles, planillas y configuración.'),
  ('hr',           'Recursos Humanos', 'Gestión de empleados, asistencias, vacaciones y comprobantes.'),
  ('accountant',   'Contabilidad', 'Generación, aprobación y cierre de planillas; conceptos y reportes contables.'),
  ('viewer',       'Solo lectura', 'Consulta de información sin permisos de edición.')
ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint

-- Permisos de tenant_admin = todos los permisos del catálogo con scope='tenant'
INSERT INTO payroll_auth.system_role_permissions (role_code, permission_code)
SELECT 'tenant_admin', code
  FROM payroll_auth.permissions_catalog
 WHERE scope = 'tenant'
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- Permisos de hr (subset)
INSERT INTO payroll_auth.system_role_permissions (role_code, permission_code)
SELECT 'hr', code FROM payroll_auth.permissions_catalog
 WHERE code IN (
   'employees:read','employees:create','employees:update','employees:delete',
   'attendance:read','attendance:create','attendance:update',
   'vacations:read','vacations:approve','vacations:create',
   'loans:read','loans:create','loans:update',
   'payslip:read','payslip:send',
   'reports:personnel.view','reports:attendance.view',
   'employee_files:read','employee_files:write','employee_files:delete'
 )
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- Permisos de accountant (subset)
INSERT INTO payroll_auth.system_role_permissions (role_code, permission_code)
SELECT 'accountant', code FROM payroll_auth.permissions_catalog
 WHERE code IN (
   'payroll:read','payroll:generate','payroll:approve','payroll:close','payroll:adjust',
   'concepts:read','concepts:write',
   'catalogs:read','catalogs:write',
   'reports:payroll.view','reports:payroll.export',
   'employees:read'
 )
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- Permisos de viewer (subset solo lectura)
INSERT INTO payroll_auth.system_role_permissions (role_code, permission_code)
SELECT 'viewer', code FROM payroll_auth.permissions_catalog
 WHERE code IN (
   'employees:read','attendance:read','vacations:read','loans:read',
   'payroll:read','concepts:read','catalogs:read','payslip:read',
   'reports:payroll.view','reports:personnel.view','reports:attendance.view'
 )
ON CONFLICT DO NOTHING;
