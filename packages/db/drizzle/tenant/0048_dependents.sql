-- Employee dependents (family members / carga familiar).
CREATE TABLE IF NOT EXISTS dependents (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id   uuid        NOT NULL,
  first_name    varchar(100) NOT NULL,
  last_name     varchar(100) NOT NULL,
  id_number     varchar(20),
  relationship  varchar(30)  NOT NULL DEFAULT 'other',
  birth_date    date,
  sex           varchar(10),
  has_disability boolean    NOT NULL DEFAULT false,
  disability_description text,
  is_active     boolean     NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dependents_employee_idx ON dependents(employee_id);
