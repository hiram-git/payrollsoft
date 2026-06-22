-- Datos institucionales para reportes de gobierno y contraloría (SIPE/SIACAP,
-- bloqueos presupuestarios, TXT de contabilidad). Antes estaban hardcodeados
-- en los scripts legacy (Nº patronal, ministerio/entidad).
ALTER TABLE company_config ADD COLUMN IF NOT EXISTS patronal_number varchar(20);
ALTER TABLE company_config ADD COLUMN IF NOT EXISTS entity_code varchar(10);
ALTER TABLE company_config ADD COLUMN IF NOT EXISTS entity_name varchar(255);
