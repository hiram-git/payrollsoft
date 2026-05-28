-- Password reset tokens for the employee self-service portal.
ALTER TABLE employee_credentials
  ADD COLUMN IF NOT EXISTS reset_token varchar(255),
  ADD COLUMN IF NOT EXISTS reset_token_expires_at timestamptz;
