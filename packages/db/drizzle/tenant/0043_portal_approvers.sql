-- Portal approver flag for employee credentials.
-- Employees marked as approvers can approve/reject requests
-- from other employees in their department via the portal.
ALTER TABLE employee_credentials
  ADD COLUMN IF NOT EXISTS is_approver boolean NOT NULL DEFAULT false;
