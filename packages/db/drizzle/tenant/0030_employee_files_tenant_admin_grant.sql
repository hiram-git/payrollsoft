-- Asigna los permisos `employee_files:*` al rol seedeado
-- `tenant_admin`. Necesario para tenants ya provisionados antes de
-- la migración 0029: los códigos se agregaron al catálogo global
-- (`payroll_auth.permissions_catalog`) pero los `role_permissions`
-- per-tenant no incluyen aún las nuevas filas.
--
-- Idempotente: ON CONFLICT DO NOTHING. Solo toca tenant_admin; el
-- resto de roles (HR, Contabilidad, Solo lectura) se ajustan a mano
-- por el administrador del tenant según corresponda.

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code
FROM roles r
CROSS JOIN (VALUES
  ('employee_files:read'),
  ('employee_files:write'),
  ('employee_files:delete')
) AS p(code)
WHERE r.code = 'tenant_admin'
ON CONFLICT (role_id, permission_code) DO NOTHING;

--> statement-breakpoint

-- Bump `permissions_version` de los usuarios con rol tenant_admin
-- para que su próxima request invalide el JWT cacheado y vuelvan a
-- emitirse permisos al hacer login. Sin esto, los usuarios activos
-- no verán "Expedientes" hasta cerrar sesión y volver a entrar.
UPDATE users
   SET permissions_version = permissions_version + 1
 WHERE id IN (
   SELECT ur.user_id
   FROM user_roles ur
   JOIN roles r ON r.id = ur.role_id
   WHERE r.code = 'tenant_admin'
 );
