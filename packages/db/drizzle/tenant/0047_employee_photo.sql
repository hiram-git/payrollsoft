-- Employee photo stored as base64 data URI (same pattern as companyLogo).
ALTER TABLE employees ADD COLUMN IF NOT EXISTS photo text;
