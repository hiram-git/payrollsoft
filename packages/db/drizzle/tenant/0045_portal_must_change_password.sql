-- Must-change-password flag for first login with default password.
ALTER TABLE employee_credentials
  ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT true;
