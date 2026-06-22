-- Fecha de fin de contrato (contratos a término). Se usa para detectar
-- contratos próximos a vencer en los reportes de personal.
ALTER TABLE employees ADD COLUMN IF NOT EXISTS contract_end_date date;
