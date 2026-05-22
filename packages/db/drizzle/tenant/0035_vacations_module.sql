-- Rework del módulo de vacaciones.
--
-- Las dos tablas existentes (`vacation_balances`, `vacation_requests`)
-- estaban en el schema desde el bootstrap pero nunca tuvieron uso —
-- ningún módulo de la API lee/escribe ahí. Las dropeamos para crear
-- el modelo definitivo que soporta los requisitos funcionales:
--
--   • Dos pools de saldo por empleado:
--       - `enjoy` (días de disfrute con goce de sueldo)
--       - `paid`  (días que se pagan sin tomar tiempo libre)
--     Cada año cumplido suma +30 a cada pool.
--
--   • Saldo "reservado" — al solicitar se reserva, al rechazar se
--     libera, al aprobar se commitea (sale de reserved y entra a used).
--
--   • Ledger append-only `vacation_balance_movements` con todos los
--     cambios (accrual, reservation, release, commit, adjustment) para
--     auditoría.
--
--   • Ciclo de vida de la solicitud:
--       pending → approved → processed
--                ↘ rejected
--                ↘ cancelled
--
--   • Reglas de aprobación opt-in similares a `employee_file_approval_rules`:
--     mapean (request_type, departamento) → rol aprobador. Si no hay
--     regla, fallback a tenant_admin (mismo patrón que expedientes).

DROP TABLE IF EXISTS vacation_requests;
--> statement-breakpoint
DROP TABLE IF EXISTS vacation_balances;
--> statement-breakpoint

CREATE TABLE vacation_balances (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id         uuid        NOT NULL UNIQUE
                                  REFERENCES employees(id) ON DELETE CASCADE,
  enjoy_earned        integer     NOT NULL DEFAULT 0,
  enjoy_used          integer     NOT NULL DEFAULT 0,
  enjoy_reserved      integer     NOT NULL DEFAULT 0,
  paid_earned         integer     NOT NULL DEFAULT 0,
  paid_used           integer     NOT NULL DEFAULT 0,
  paid_reserved       integer     NOT NULL DEFAULT 0,
  last_accrual_date   date,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (enjoy_earned   >= 0),
  CHECK (enjoy_used     >= 0),
  CHECK (enjoy_reserved >= 0),
  CHECK (paid_earned    >= 0),
  CHECK (paid_used      >= 0),
  CHECK (paid_reserved  >= 0)
);
--> statement-breakpoint

CREATE TABLE vacation_requests (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  request_number   varchar(20) NOT NULL UNIQUE,
  employee_id      uuid        NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  request_type     varchar(20) NOT NULL,
  start_date       date,
  end_date         date,
  enjoy_days       integer     NOT NULL DEFAULT 0,
  paid_days        integer     NOT NULL DEFAULT 0,
  reason           text,
  status           varchar(20) NOT NULL DEFAULT 'pending',
  requested_by     uuid,
  approved_by      uuid,
  approved_at      timestamptz,
  rejection_reason text,
  processed_at     timestamptz,
  payroll_id       uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vacation_requests_type_check
    CHECK (request_type IN ('enjoy', 'pay', 'mixed')),
  CONSTRAINT vacation_requests_status_check
    CHECK (status IN ('pending', 'approved', 'rejected', 'processed', 'cancelled')),
  CONSTRAINT vacation_requests_days_check
    CHECK (enjoy_days >= 0 AND paid_days >= 0 AND (enjoy_days + paid_days) > 0),
  CONSTRAINT vacation_requests_dates_check
    CHECK (start_date IS NULL OR end_date IS NULL OR start_date <= end_date)
);
--> statement-breakpoint

CREATE INDEX vacation_requests_employee_idx ON vacation_requests (employee_id);
--> statement-breakpoint
CREATE INDEX vacation_requests_status_idx   ON vacation_requests (status);
--> statement-breakpoint
CREATE INDEX vacation_requests_created_idx  ON vacation_requests (created_at DESC);
--> statement-breakpoint

CREATE TABLE vacation_balance_movements (
  id            bigserial   PRIMARY KEY,
  employee_id   uuid        NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  request_id    uuid        REFERENCES vacation_requests(id) ON DELETE SET NULL,
  movement_type varchar(20) NOT NULL,
  pool          varchar(10) NOT NULL,
  days          integer     NOT NULL,
  notes         text,
  performed_by  uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vacation_movements_type_check
    CHECK (movement_type IN ('accrual', 'reservation', 'release', 'commit', 'adjustment')),
  CONSTRAINT vacation_movements_pool_check
    CHECK (pool IN ('enjoy', 'paid'))
);
--> statement-breakpoint

CREATE INDEX vacation_movements_employee_idx ON vacation_balance_movements (employee_id, created_at DESC);
--> statement-breakpoint
CREATE INDEX vacation_movements_request_idx  ON vacation_balance_movements (request_id);
--> statement-breakpoint

-- Reglas de aprobación opt-in. Misma forma que `employee_file_approval_rules`:
-- una regla con `request_type IS NULL AND department_id IS NULL` aplica a
-- todo; reglas más específicas ganan. Si no hay regla activa, el
-- fallback en el service es `tenant_admin`.
CREATE TABLE vacation_approval_rules (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  request_type  varchar(20),
  department_id uuid,
  approver_role varchar(50) NOT NULL,
  is_active     integer     NOT NULL DEFAULT 1,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vacation_rules_type_check
    CHECK (request_type IS NULL OR request_type IN ('enjoy', 'pay', 'mixed'))
);
--> statement-breakpoint

CREATE UNIQUE INDEX vacation_rules_unique
  ON vacation_approval_rules (
    COALESCE(request_type, ''),
    COALESCE(department_id::text, ''),
    approver_role
  )
  WHERE is_active = 1;
