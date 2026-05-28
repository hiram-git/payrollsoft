-- Government compliance fields for employee records (Panamá).
-- All columns nullable to maintain backward compatibility with
-- existing private-sector tenants.

-- 5.1 Personal data
ALTER TABLE employees ADD COLUMN IF NOT EXISTS second_name varchar(100);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS second_surname varchar(100);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS married_surname varchar(100);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS id_prefix varchar(5);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS id_province varchar(5);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS id_volume varchar(10);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS id_folio varchar(10);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS scanned_id text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS sex varchar(10);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS marital_status varchar(20);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS nationality varchar(30);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS birth_date date;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS birth_place varchar(255);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS personal_email varchar(255);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS address_province varchar(100);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS address_district varchar(100);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS address_township varchar(100);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS address varchar(500);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS other_address varchar(500);

-- 5.2 Labor / government data
ALTER TABLE employees ADD COLUMN IF NOT EXISTS decree_number varchar(50);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS resolution_number varchar(50);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS decree_date date;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS resolution_date date;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS collaborator_number varchar(20);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS external_user_ref varchar(100);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS contract_type varchar(40);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS ir_key varchar(20);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS shift_id uuid;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS weekly_base_hours varchar(10);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS observations text;

-- 5.3 Termination / payment
ALTER TABLE employees ADD COLUMN IF NOT EXISTS termination_decree varchar(50);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS termination_resolution varchar(50);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS termination_decree_date date;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS termination_resolution_date date;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS termination_reason varchar(255);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS siacap_pct varchar(10);
