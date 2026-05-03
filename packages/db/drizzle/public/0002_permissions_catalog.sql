-- Phase 1.1: master catalog of RBAC permission codes. Lives in payroll_auth
-- so it is shared by all tenants; tenants reference codes by string in their
-- own role_permissions tables (logical FK, validated at the application layer).

CREATE TABLE IF NOT EXISTS payroll_auth.permissions_catalog (
  code         varchar(80)  PRIMARY KEY,
  module       varchar(40)  NOT NULL,
  action       varchar(40)  NOT NULL,
  scope        varchar(20)  NOT NULL DEFAULT 'tenant',
  description  text         NOT NULL,
  is_dangerous boolean      NOT NULL DEFAULT false,
  created_at   timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT permissions_catalog_scope_check
    CHECK (scope IN ('tenant','global')),
  CONSTRAINT permissions_catalog_code_format
    CHECK (code ~ '^[a-z_]+:[a-z_]+(\.[a-z_]+)?$')
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS permissions_catalog_module_idx
  ON payroll_auth.permissions_catalog (module);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS permissions_catalog_scope_idx
  ON payroll_auth.permissions_catalog (scope);
--> statement-breakpoint

-- Seed the catalog. Idempotent via ON CONFLICT — running this migration on
-- an environment with an older catalog version will refresh descriptions
-- without dropping existing role_permissions rows.
INSERT INTO payroll_auth.permissions_catalog (code, module, action, scope, description, is_dangerous) VALUES
  -- Employees / positions / shifts
  ('employees:create',     'employees',  'create',     'tenant', 'Create employees',                              false),
  ('employees:read',       'employees',  'read',       'tenant', 'List and view employees',                        false),
  ('employees:update',     'employees',  'update',     'tenant', 'Edit employee data',                             false),
  ('employees:delete',     'employees',  'delete',     'tenant', 'Delete or deactivate employees',                 true),
  ('employees:import',     'employees',  'import',     'tenant', 'Bulk import employees',                          false),
  ('employees:export',     'employees',  'export',     'tenant', 'Export employees to CSV/PDF',                    false),
  ('positions:create',     'positions',  'create',     'tenant', 'Create job positions',                           false),
  ('positions:read',       'positions',  'read',       'tenant', 'View job positions',                             false),
  ('positions:update',     'positions',  'update',     'tenant', 'Edit job positions',                             false),
  ('positions:delete',     'positions',  'delete',     'tenant', 'Delete job positions',                           true),
  ('shifts:create',        'shifts',     'create',     'tenant', 'Create shifts',                                  false),
  ('shifts:read',          'shifts',     'read',       'tenant', 'View shifts',                                    false),
  ('shifts:update',        'shifts',     'update',     'tenant', 'Edit shifts',                                    false),
  ('shifts:delete',        'shifts',     'delete',     'tenant', 'Delete shifts',                                  true),
  ('shifts:assign',        'shifts',     'assign',     'tenant', 'Assign shifts to employees',                     false),

  -- Attendance & vacations
  ('attendance:read',      'attendance', 'read',       'tenant', 'View attendance records',                        false),
  ('attendance:mark',      'attendance', 'mark',       'tenant', 'Register attendance entries',                    false),
  ('attendance:import',    'attendance', 'import',     'tenant', 'Bulk import attendance',                         false),
  ('attendance:edit',      'attendance', 'edit',       'tenant', 'Edit attendance records',                        false),
  ('attendance:approve',   'attendance', 'approve',    'tenant', 'Approve attendance adjustments',                 false),
  ('vacations:request',    'vacations',  'request',    'tenant', 'Request vacation periods',                       false),
  ('vacations:read',       'vacations',  'read',       'tenant', 'View vacation balances and history',             false),
  ('vacations:approve',    'vacations',  'approve',    'tenant', 'Approve vacation requests',                      false),
  ('vacations:reject',     'vacations',  'reject',     'tenant', 'Reject vacation requests',                       false),
  ('vacations:cancel',     'vacations',  'cancel',     'tenant', 'Cancel vacation periods',                        false),

  -- Loans / advances / creditors
  ('loans:create',         'loans',      'create',     'tenant', 'Register employee loans',                        false),
  ('loans:read',           'loans',      'read',       'tenant', 'View loans',                                     false),
  ('loans:update',         'loans',      'update',     'tenant', 'Edit loan terms',                                false),
  ('loans:approve',        'loans',      'approve',    'tenant', 'Approve loans',                                  false),
  ('loans:reject',         'loans',      'reject',     'tenant', 'Reject loans',                                   false),
  ('loans:cancel',         'loans',      'cancel',     'tenant', 'Cancel loans',                                   true),
  ('advances:create',      'advances',   'create',     'tenant', 'Register salary advances',                       false),
  ('advances:read',        'advances',   'read',       'tenant', 'View salary advances',                           false),
  ('advances:approve',     'advances',   'approve',    'tenant', 'Approve salary advances',                        false),
  ('advances:reject',      'advances',   'reject',     'tenant', 'Reject salary advances',                         false),
  ('creditors:create',     'creditors',  'create',     'tenant', 'Create creditors',                               false),
  ('creditors:read',       'creditors',  'read',       'tenant', 'View creditors',                                 false),
  ('creditors:update',     'creditors',  'update',     'tenant', 'Edit creditors',                                 false),
  ('creditors:delete',     'creditors',  'delete',     'tenant', 'Delete creditors',                               true),

  -- Payroll / concepts / catalogs
  ('payroll:create',       'payroll',    'create',     'tenant', 'Create payroll runs',                            false),
  ('payroll:read',         'payroll',    'read',       'tenant', 'View payroll runs',                              false),
  ('payroll:generate',     'payroll',    'generate',   'tenant', 'Generate payroll calculations',                  false),
  ('payroll:recalculate',  'payroll',    'recalculate','tenant', 'Recalculate an existing payroll run',            false),
  ('payroll:approve',      'payroll',    'approve',    'tenant', 'Approve payroll runs',                           true),
  ('payroll:close',        'payroll',    'close',      'tenant', 'Close payroll runs',                             true),
  ('payroll:reopen',       'payroll',    'reopen',     'tenant', 'Reopen closed payroll runs',                     true),
  ('payroll:export',       'payroll',    'export',     'tenant', 'Export payroll data',                            false),
  ('concepts:create',      'concepts',   'create',     'tenant', 'Create payroll concepts',                        false),
  ('concepts:read',        'concepts',   'read',       'tenant', 'View payroll concepts',                          false),
  ('concepts:update',      'concepts',   'update',     'tenant', 'Edit payroll concepts',                          false),
  ('concepts:delete',      'concepts',   'delete',     'tenant', 'Delete payroll concepts',                        true),
  ('catalogs:create',      'catalogs',   'create',     'tenant', 'Create catalog entries',                         false),
  ('catalogs:read',        'catalogs',   'read',       'tenant', 'View catalogs',                                  false),
  ('catalogs:update',      'catalogs',   'update',     'tenant', 'Edit catalogs',                                  false),
  ('catalogs:delete',      'catalogs',   'delete',     'tenant', 'Delete catalog entries',                         true),

  -- Payslips
  ('payslip:read',         'payslip',    'read',       'tenant', 'View payslips',                                  false),
  ('payslip:download',     'payslip',    'download',   'tenant', 'Download payslip PDFs',                          false),
  ('payslip:send_email',   'payslip',    'send_email', 'tenant', 'Send payslips by email',                         false),
  ('payslip:resend',       'payslip',    'resend',     'tenant', 'Resend previously delivered payslips',           false),

  -- Reports
  ('reports:payroll.view',      'reports', 'payroll.view',      'tenant', 'View payroll reports',          false),
  ('reports:payroll.export',    'reports', 'payroll.export',    'tenant', 'Export payroll reports',        false),
  ('reports:personnel.view',    'reports', 'personnel.view',    'tenant', 'View personnel reports',        false),
  ('reports:personnel.export',  'reports', 'personnel.export',  'tenant', 'Export personnel reports',      false),
  ('reports:attendance.view',   'reports', 'attendance.view',   'tenant', 'View attendance reports',       false),
  ('reports:attendance.export', 'reports', 'attendance.export', 'tenant', 'Export attendance reports',     false),
  ('reports:loans.view',        'reports', 'loans.view',        'tenant', 'View loan reports',             false),

  -- Tenant administration
  ('users:create',         'users',      'create',     'tenant', 'Create users in the tenant',                     false),
  ('users:read',           'users',      'read',       'tenant', 'View users',                                     false),
  ('users:update',         'users',      'update',     'tenant', 'Edit users',                                     false),
  ('users:deactivate',     'users',      'deactivate', 'tenant', 'Deactivate users',                               true),
  ('roles:create',         'roles',      'create',     'tenant', 'Create roles',                                   false),
  ('roles:read',           'roles',      'read',       'tenant', 'View roles',                                     false),
  ('roles:update',         'roles',      'update',     'tenant', 'Edit roles and their permissions',               false),
  ('roles:delete',         'roles',      'delete',     'tenant', 'Delete roles',                                   true),
  ('roles:assign',         'roles',      'assign',     'tenant', 'Assign roles to users',                          false),
  ('settings:company.read',   'settings', 'company.read',   'tenant', 'View company settings',                     false),
  ('settings:company.update', 'settings', 'company.update', 'tenant', 'Edit company settings',                     false),
  ('audit:read',           'audit',      'read',       'tenant', 'View tenant audit log',                          false),

  -- Global (super-admin only)
  ('tenants:create',       'tenants',    'create',     'global', 'Provision a new tenant',                         true),
  ('tenants:read',         'tenants',    'read',       'global', 'List tenants',                                   false),
  ('tenants:update',       'tenants',    'update',     'global', 'Edit tenant settings',                           false),
  ('tenants:suspend',      'tenants',    'suspend',    'global', 'Suspend a tenant',                               true),
  ('tenants:archive',      'tenants',    'archive',    'global', 'Archive a tenant',                               true),
  ('super_admins:create',     'super_admins', 'create',     'global', 'Create super admins',                       true),
  ('super_admins:read',       'super_admins', 'read',       'global', 'List super admins',                          false),
  ('super_admins:update',     'super_admins', 'update',     'global', 'Edit super admins',                          false),
  ('super_admins:deactivate', 'super_admins', 'deactivate', 'global', 'Deactivate super admins',                    true)
ON CONFLICT (code) DO UPDATE
  SET module       = EXCLUDED.module,
      action       = EXCLUDED.action,
      scope        = EXCLUDED.scope,
      description  = EXCLUDED.description,
      is_dangerous = EXCLUDED.is_dangerous;
