-- Portal de colaboradores — credenciales y configuración de email.
--
-- Tabla `employee_credentials` separada de `employees` para mantener
-- integridad de datos. El login del portal usa la cédula (id_number
-- de employees) + password. Los admins gestionan las credenciales
-- desde /config/users o un endpoint dedicado.
--
-- Campos de email en company_config para notificaciones automáticas
-- en cada fase del proceso de solicitudes (creación, aprobación, rechazo).

CREATE TABLE IF NOT EXISTS employee_credentials (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id     uuid        NOT NULL UNIQUE,
  password_hash   varchar(255) NOT NULL,
  is_active       boolean     NOT NULL DEFAULT true,
  is_locked       boolean     NOT NULL DEFAULT false,
  failed_attempts integer     NOT NULL DEFAULT 0,
  last_login_at   timestamptz,
  password_changed_at timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS employee_credentials_employee_idx
  ON employee_credentials(employee_id);
--> statement-breakpoint

-- Campos de notificación en company_config.
-- El admin configura quién recibe los emails en cada fase.
ALTER TABLE company_config
  ADD COLUMN IF NOT EXISTS portal_notifications_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS notify_on_request_created text,
  ADD COLUMN IF NOT EXISTS notify_on_request_approved text,
  ADD COLUMN IF NOT EXISTS notify_on_request_rejected text;
