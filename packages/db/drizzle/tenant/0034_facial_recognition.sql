-- Phase 10: Facial-recognition attendance.
--
-- Four tables added to the tenant schema:
--   facial_terminals          — registered kiosks
--   facial_enrollments        — per-employee facial embeddings (pgvector(128))
--   facial_marcaciones        — raw events captured by kiosks/manual
--   facial_terminal_events    — heartbeats / kiosk audits
--
-- Embeddings come from @vladmandic/face-api FaceRecognitionNet (128-dim).
-- A periodic consolidator folds rows from facial_marcaciones into the
-- existing attendance_records table — the payroll engine keeps reading
-- a single source of truth (workedMinutes, lateMinutes, overtimeMinutes).
--
-- ⚠ REQUIERE pgvector. Si la extensión no está disponible en el servidor
-- PostgreSQL, esta migración hace no-op (sólo registra un NOTICE) y el
-- módulo de reconocimiento facial queda DESHABILITADO en este tenant.
--
-- Para habilitar el módulo:
--   1. Instalar pgvector en el servidor (Ubuntu/Debian):
--        sudo apt install postgresql-16-pgvector
--      o usar el paquete que corresponda a tu versión de PostgreSQL.
--   2. Re-correr esta migración manualmente con:
--        DELETE FROM __drizzle_migrations WHERE hash LIKE '%0034%';
--        bun run --filter @payroll/db db:migrate:all-tenants
--
-- El resto del sistema (planilla, vacaciones, expedientes, tesorería)
-- funciona normalmente sin pgvector — sólo el módulo facial requiere
-- la extensión.

DO $facial_module$
DECLARE
  has_vector boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_available_extensions WHERE name = 'vector'
  ) INTO has_vector;

  IF NOT has_vector THEN
    RAISE NOTICE '⚠ pgvector no disponible en este servidor — módulo de reconocimiento facial DESHABILITADO en este tenant. Para habilitarlo, instala postgresql-NN-pgvector y re-corre la migración 0034.';
    RETURN;
  END IF;

  -- Extensión global a la base (PostgreSQL solo permite una copia por DB)
  -- pero los tipos quedan accesibles desde cualquier schema.
  EXECUTE 'CREATE EXTENSION IF NOT EXISTS vector';

  -- ─── Terminals ─────────────────────────────────────────────────────────
  EXECUTE $sql$
    CREATE TABLE IF NOT EXISTS facial_terminals (
      id              uuid          DEFAULT gen_random_uuid() PRIMARY KEY,
      code            varchar(60)   NOT NULL,
      name            varchar(160)  NOT NULL,
      location        varchar(200),
      status          varchar(20)   NOT NULL DEFAULT 'active',
      api_token_hash  varchar(128),
      last_seen_at    timestamptz,
      app_version     varchar(40),
      meta            jsonb         NOT NULL DEFAULT '{}'::jsonb,
      created_at      timestamptz   NOT NULL DEFAULT now(),
      updated_at      timestamptz   NOT NULL DEFAULT now()
    )
  $sql$;

  EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS facial_terminals_code_unique ON facial_terminals(code)';

  -- ─── Enrollments ───────────────────────────────────────────────────────
  EXECUTE $sql$
    CREATE TABLE IF NOT EXISTS facial_enrollments (
      id                   uuid          DEFAULT gen_random_uuid() PRIMARY KEY,
      employee_id          uuid          NOT NULL,
      embedding            vector(128)   NOT NULL,
      photo_url            text,
      quality_score        numeric(5,4),
      is_primary           boolean       NOT NULL DEFAULT false,
      status               varchar(20)   NOT NULL DEFAULT 'active',
      enrolled_by_user_id  uuid,
      enrolled_at          timestamptz   NOT NULL DEFAULT now(),
      revoked_at           timestamptz,
      notes                text
    )
  $sql$;

  EXECUTE 'CREATE INDEX IF NOT EXISTS facial_enrollments_employee_idx ON facial_enrollments(employee_id)';

  -- HNSW index for fast cosine-distance KNN search. Embeddings from
  -- face-api are unit-normalised, so cosine ≈ L2 — we use cosine which
  -- is what the application also computes for the confidence score.
  EXECUTE $sql$
    CREATE INDEX IF NOT EXISTS facial_enrollments_embedding_hnsw
      ON facial_enrollments
      USING hnsw (embedding vector_cosine_ops)
      WHERE status = 'active'
  $sql$;

  -- ─── Marcaciones (raw events) ──────────────────────────────────────────
  EXECUTE $sql$
    CREATE TABLE IF NOT EXISTS facial_marcaciones (
      id                     uuid          DEFAULT gen_random_uuid() PRIMARY KEY,
      employee_id            uuid,
      terminal_id            uuid,
      kind                   varchar(20)   NOT NULL,
      captured_at            timestamptz   NOT NULL,
      confidence             numeric(6,5),
      match_distance         numeric(6,5),
      liveness_score         numeric(5,4),
      photo_url              text,
      matched_enrollment_id  uuid,
      idempotency_key        varchar(100),
      client_event_id        varchar(100),
      source                 varchar(20)   NOT NULL DEFAULT 'kiosk',
      status                 varchar(20)   NOT NULL DEFAULT 'verified',
      supervisor_user_id     uuid,
      justification          text,
      device_meta            jsonb         NOT NULL DEFAULT '{}'::jsonb,
      created_at             timestamptz   NOT NULL DEFAULT now(),
      CONSTRAINT facial_marcaciones_kind_check CHECK (
        kind IN ('entry','exit','lunch_start','lunch_end','extra')
      ),
      CONSTRAINT facial_marcaciones_status_check CHECK (
        status IN ('verified','pending','rejected','manual')
      )
    )
  $sql$;

  EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS facial_marcaciones_idem_key_unique ON facial_marcaciones(idempotency_key) WHERE idempotency_key IS NOT NULL';
  EXECUTE 'CREATE INDEX IF NOT EXISTS facial_marcaciones_employee_captured_idx ON facial_marcaciones(employee_id, captured_at DESC)';
  EXECUTE 'CREATE INDEX IF NOT EXISTS facial_marcaciones_captured_idx ON facial_marcaciones(captured_at DESC)';
  EXECUTE 'CREATE INDEX IF NOT EXISTS facial_marcaciones_terminal_idx ON facial_marcaciones(terminal_id)';

  -- ─── Terminal events ───────────────────────────────────────────────────
  EXECUTE $sql$
    CREATE TABLE IF NOT EXISTS facial_terminal_events (
      id            uuid          DEFAULT gen_random_uuid() PRIMARY KEY,
      terminal_id   uuid          NOT NULL,
      kind          varchar(40)   NOT NULL,
      payload       jsonb         NOT NULL DEFAULT '{}'::jsonb,
      created_at    timestamptz   NOT NULL DEFAULT now()
    )
  $sql$;

  EXECUTE 'CREATE INDEX IF NOT EXISTS facial_terminal_events_terminal_idx ON facial_terminal_events(terminal_id, created_at DESC)';
END $facial_module$;
--> statement-breakpoint

-- Grants de permisos del módulo facial a los roles seedeados.
-- Se ejecutan SIEMPRE (no requieren pgvector) — los permission codes
-- están en payroll_auth.permissions_catalog independientemente de si
-- las tablas facial existen o no. Si el módulo se habilita después,
-- los roles ya tendrán los grants.
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code
  FROM roles r
  CROSS JOIN (
    VALUES
      ('facial:enroll'),
      ('facial:read'),
      ('facial:mark'),
      ('facial:override'),
      ('facial:admin'),
      ('terminals:read'),
      ('terminals:write')
  ) AS p(code)
 WHERE r.code = 'tenant_admin'
ON CONFLICT (role_id, permission_code) DO NOTHING;
--> statement-breakpoint

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code
  FROM roles r
  CROSS JOIN (
    VALUES
      ('facial:enroll'),
      ('facial:read'),
      ('facial:override')
  ) AS p(code)
 WHERE r.code = 'hr'
ON CONFLICT (role_id, permission_code) DO NOTHING;
--> statement-breakpoint

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, 'facial:read'
  FROM roles r
 WHERE r.code IN ('accountant','viewer')
ON CONFLICT (role_id, permission_code) DO NOTHING;
