-- Workflow de aprobaciones para expedientes.
--
-- Cada expediente gana un `status` (pending|approved|rejected). El
-- default es `approved` para mantener compatibilidad con los
-- expedientes ya guardados; los nuevos comienzan en `pending` si
-- el (tipo, subtipo) tiene una regla declarada en
-- `employee_file_approval_rules`.
--
-- `approved_by` / `approved_at` / `rejection_reason` se llenan al
-- emitirse la decisión. Pensado para auditoría — el archivo y los
-- datos no se mutan al aprobar/rechazar, solo cambia el status.

-- ── Columnas de aprobación ────────────────────────────────────────────────
ALTER TABLE employee_files
  ADD COLUMN IF NOT EXISTS approval_status varchar(20) NOT NULL DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS approved_by     uuid,
  ADD COLUMN IF NOT EXISTS approved_at     timestamptz,
  ADD COLUMN IF NOT EXISTS rejection_reason text;
--> statement-breakpoint

ALTER TABLE employee_files
  ADD CONSTRAINT employee_files_approval_status_check
  CHECK (approval_status IN ('pending', 'approved', 'rejected'));
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS employee_files_pending_idx
  ON employee_files (approval_status)
  WHERE approval_status = 'pending';
--> statement-breakpoint

-- ── Reglas de aprobación por tipo/subtipo ────────────────────────────────
-- Cada fila declara: "los expedientes del tipo X (opcionalmente
-- restringidos al subtipo Y) requieren aprobación del rol Z".
-- Si hay rule para (typeId, subtypeId=null) se aplica a TODOS los
-- subtipos del tipo. Si hay otra rule más específica con subtypeId
-- definido, esa prevalece (más específica gana).
-- `is_active` se modela como integer (0/1) para mantener la
-- convención del resto del módulo (employee_file_types,
-- employee_file_subtypes). Los queries del service comparan
-- contra `= 1`, y el Drizzle schema lo refleja como `integer`.
CREATE TABLE IF NOT EXISTS employee_file_approval_rules (
  id              uuid          DEFAULT gen_random_uuid() PRIMARY KEY,
  type_id         integer       NOT NULL REFERENCES employee_file_types(id) ON DELETE CASCADE,
  subtype_id      integer       REFERENCES employee_file_subtypes(id) ON DELETE CASCADE,
  approver_role   varchar(50)   NOT NULL,
  is_active       integer       NOT NULL DEFAULT 1,
  created_at      timestamptz   NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS employee_file_approval_rules_unique
  ON employee_file_approval_rules (type_id, COALESCE(subtype_id, 0), approver_role);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS employee_file_approval_rules_type_idx
  ON employee_file_approval_rules (type_id, subtype_id);
--> statement-breakpoint

-- ── Permisos al rol tenant_admin ──────────────────────────────────────────
-- tenant_admin puede aprobar/rechazar todo. Roles más específicos
-- (jefe de departamento, supervisor) se cargan a mano desde
-- /config/roles según la política del tenant.
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code
FROM roles r
CROSS JOIN (VALUES
  ('employee_files:approve')
) AS p(code)
WHERE r.code = 'tenant_admin'
ON CONFLICT (role_id, permission_code) DO NOTHING;
--> statement-breakpoint

-- Invalidar JWT cacheado de tenant_admin para que la próxima request
-- los emita con el nuevo permiso.
UPDATE users
   SET permissions_version = permissions_version + 1
 WHERE id IN (
   SELECT ur.user_id
   FROM user_roles ur
   JOIN roles r ON r.id = ur.role_id
   WHERE r.code = 'tenant_admin'
 );
