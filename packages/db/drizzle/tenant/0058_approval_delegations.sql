-- Temporary delegation of an approver's identity for a single approval step.
-- While a delegation is active for a date, resolveApprover() returns the
-- delegate instead of the original delegator. NOT a multi-level chain.

CREATE TABLE IF NOT EXISTS approval_delegations (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  delegator_user_id   UUID NOT NULL,
  delegate_user_id    UUID NOT NULL,
  valid_from          DATE NOT NULL,
  valid_to            DATE NOT NULL,
  reason              TEXT,
  created_by          UUID,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS approval_delegations_delegator_idx
  ON approval_delegations (delegator_user_id);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS approval_delegations_range_idx
  ON approval_delegations (valid_from, valid_to);
