-- New file types and subtypes for compensatory time workflows:
-- ausencias, tardanzas, omisiones, cumpleanos, mision_oficial (standalone)
-- Also add horas_extra as a type for overtime tracking.

-- New types
INSERT INTO employee_file_types (code, name, sort_order, requires_approval) VALUES
  ('ausencias',       'Ausencias',        14, 1),
  ('tardanzas',       'Tardanzas',        15, 1),
  ('horas_extra',     'Horas Extra',      16, 1),
  ('omisiones',       'Omisiones',        17, 1),
  ('cumpleanos',      'Cumpleaños',       18, 0),
  ('mision_oficial',  'Misión Oficial',   19, 1)
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, sort_order = EXCLUDED.sort_order, requires_approval = EXCLUDED.requires_approval;
--> statement-breakpoint

-- Subtypes for Ausencias
INSERT INTO employee_file_subtypes (type_id, code, name, sort_order, requires_approval)
SELECT t.id, s.code, s.name, s.sort_order, 1
FROM employee_file_types t
JOIN (VALUES
  ('ausencias', 'enfermedad',              'Enfermedad',                     1),
  ('ausencias', 'duelo',                   'Duelo',                          2),
  ('ausencias', 'matrimonio',              'Matrimonio',                     3),
  ('ausencias', 'nacimiento_hijo',         'Nacimiento de hijo',             4),
  ('ausencias', 'enfermedad_pariente',     'Enfermedad de pariente cercano', 5),
  ('ausencias', 'eventos_academicos',      'Eventos académicos',             6),
  ('ausencias', 'asuntos_personales',      'Asuntos personales',             7)
) AS s(type_code, code, name, sort_order)
ON t.code = s.type_code
ON CONFLICT ON CONSTRAINT employee_file_subtypes_type_code_unique DO UPDATE
SET name = EXCLUDED.name, sort_order = EXCLUDED.sort_order, requires_approval = EXCLUDED.requires_approval;
--> statement-breakpoint

-- Subtypes for Tardanzas
INSERT INTO employee_file_subtypes (type_id, code, name, sort_order, requires_approval)
SELECT t.id, s.code, s.name, s.sort_order, 1
FROM employee_file_types t
JOIN (VALUES
  ('tardanzas', 'fuertes_lluvias',     'Fuertes lluvias',           1),
  ('tardanzas', 'huelga',              'Huelga',                    2),
  ('tardanzas', 'cita_medica',         'Asistencia a cita médica',  3),
  ('tardanzas', 'otros',               'Otros',                     4)
) AS s(type_code, code, name, sort_order)
ON t.code = s.type_code
ON CONFLICT ON CONSTRAINT employee_file_subtypes_type_code_unique DO UPDATE
SET name = EXCLUDED.name, sort_order = EXCLUDED.sort_order, requires_approval = EXCLUDED.requires_approval;
--> statement-breakpoint

-- Subtypes for Horas Extra
INSERT INTO employee_file_subtypes (type_id, code, name, sort_order, requires_approval)
SELECT t.id, s.code, s.name, s.sort_order, 1
FROM employee_file_types t
JOIN (VALUES
  ('horas_extra', 'diurnas',     'Horas extra diurnas',     1),
  ('horas_extra', 'nocturnas',   'Horas extra nocturnas',   2),
  ('horas_extra', 'feriado',     'Horas extra en feriado',  3)
) AS s(type_code, code, name, sort_order)
ON t.code = s.type_code
ON CONFLICT ON CONSTRAINT employee_file_subtypes_type_code_unique DO UPDATE
SET name = EXCLUDED.name, sort_order = EXCLUDED.sort_order, requires_approval = EXCLUDED.requires_approval;
--> statement-breakpoint

-- Subtypes for Omisiones
INSERT INTO employee_file_subtypes (type_id, code, name, sort_order, requires_approval)
SELECT t.id, s.code, s.name, s.sort_order, 1
FROM employee_file_types t
JOIN (VALUES
  ('omisiones', 'omision_entrada',   'Omisión de marcación de entrada',  1),
  ('omisiones', 'omision_salida',    'Omisión de marcación de salida',   2),
  ('omisiones', 'omision_ambas',     'Omisión de ambas marcaciones',     3)
) AS s(type_code, code, name, sort_order)
ON t.code = s.type_code
ON CONFLICT ON CONSTRAINT employee_file_subtypes_type_code_unique DO UPDATE
SET name = EXCLUDED.name, sort_order = EXCLUDED.sort_order, requires_approval = EXCLUDED.requires_approval;
--> statement-breakpoint

-- Subtypes for Cumpleaños
INSERT INTO employee_file_subtypes (type_id, code, name, sort_order, requires_approval)
SELECT t.id, s.code, s.name, s.sort_order, 0
FROM employee_file_types t
JOIN (VALUES
  ('cumpleanos', 'dia_libre', 'Día libre por cumpleaños', 1)
) AS s(type_code, code, name, sort_order)
ON t.code = s.type_code
ON CONFLICT ON CONSTRAINT employee_file_subtypes_type_code_unique DO UPDATE
SET name = EXCLUDED.name, sort_order = EXCLUDED.sort_order, requires_approval = EXCLUDED.requires_approval;
--> statement-breakpoint

-- Subtypes for Misión Oficial
INSERT INTO employee_file_subtypes (type_id, code, name, sort_order, requires_approval)
SELECT t.id, s.code, s.name, s.sort_order, 1
FROM employee_file_types t
JOIN (VALUES
  ('mision_oficial', 'nacional',       'Misión oficial nacional',        1),
  ('mision_oficial', 'internacional',  'Misión oficial internacional',   2)
) AS s(type_code, code, name, sort_order)
ON t.code = s.type_code
ON CONFLICT ON CONSTRAINT employee_file_subtypes_type_code_unique DO UPDATE
SET name = EXCLUDED.name, sort_order = EXCLUDED.sort_order, requires_approval = EXCLUDED.requires_approval;
