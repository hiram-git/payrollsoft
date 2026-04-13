-- ── Creditors ─────────────────────────────────────────────────────────────────
-- Each creditor auto-owns a deduction concept generated at creation time.
CREATE TABLE IF NOT EXISTS creditors (
  id          UUID         NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  code        VARCHAR(20)  NOT NULL UNIQUE,
  name        VARCHAR(255) NOT NULL,
  concept_id  UUID,
  is_active   BOOLEAN      NOT NULL DEFAULT true,
  created_at  TIMESTAMP    NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMP    NOT NULL DEFAULT NOW()
);
--> statement-breakpoint

-- ── Loans: add optional creditor reference ────────────────────────────────────
ALTER TABLE loans ADD COLUMN IF NOT EXISTS creditor_id UUID;
--> statement-breakpoint

-- ── Loan installments ─────────────────────────────────────────────────────────
-- Generated at loan creation; status set to 'paid' when payroll is closed.
CREATE TABLE IF NOT EXISTS loan_installments (
  id                  UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  loan_id             UUID        NOT NULL,
  installment_number  INTEGER     NOT NULL,
  amount              VARCHAR(20) NOT NULL,
  status              VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending | paid
  payroll_id          UUID,
  paid_at             TIMESTAMP,
  created_at          TIMESTAMP   NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_loan_installments_loan FOREIGN KEY (loan_id) REFERENCES loans(id) ON DELETE CASCADE
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_loan_installments_loan_id ON loan_installments(loan_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_loan_installments_pending ON loan_installments(loan_id, status) WHERE status = 'pending';
