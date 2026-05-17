-- Phase 9: Módulo de expedientes de empleados.
--
-- Tres tablas:
--   employee_file_types         — catálogo (13 tipos seedeados)
--   employee_file_subtypes      — catálogo (60 subtipos seedeados)
--   employee_files              — registros (expedientes)
--   employee_file_attachments   — archivos adjuntos (PDFs / imágenes)
--
-- Correlativo: T{type:3}-S{subtype:3}-{year}-{seq:4}. La secuencia
-- es por (type_id, subtype_id, document_year) y se calcula con
-- FOR UPDATE dentro de una transacción para evitar colisiones.
--
-- Storage: los archivos físicos viven bajo
--   ${STORAGE_DIR}/${tenant}_storage/employee_files/employee_${id}/...
-- (gestionado por la API, no por SQL).

-- ─── Catálogo de tipos ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS employee_file_types (
  id          integer       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code        varchar(60)   NOT NULL UNIQUE,
  name        varchar(120)  NOT NULL,
  description text,
  sort_order  integer       NOT NULL DEFAULT 0,
  is_active   integer       NOT NULL DEFAULT 1,
  created_at  timestamptz   NOT NULL DEFAULT now()
);
--> statement-breakpoint

-- ─── Catálogo de subtipos ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS employee_file_subtypes (
  id          integer       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  type_id     integer       NOT NULL REFERENCES employee_file_types(id) ON DELETE CASCADE,
  code        varchar(60)   NOT NULL,
  name        varchar(160)  NOT NULL,
  sort_order  integer       NOT NULL DEFAULT 0,
  is_active   integer       NOT NULL DEFAULT 1,
  created_at  timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT employee_file_subtypes_type_code_unique UNIQUE (type_id, code)
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS employee_file_subtypes_type_idx
  ON employee_file_subtypes(type_id);
--> statement-breakpoint

-- ─── Expedientes ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS employee_files (
  id                uuid          DEFAULT gen_random_uuid() PRIMARY KEY,
  employee_id       uuid          NOT NULL,
  type_id           integer       NOT NULL REFERENCES employee_file_types(id) ON DELETE RESTRICT,
  subtype_id        integer       NOT NULL REFERENCES employee_file_subtypes(id) ON DELETE RESTRICT,
  document_date     date          NOT NULL,
  document_year     smallint      NOT NULL,
  document_sequence integer       NOT NULL,
  document_number   varchar(120)  NOT NULL,
  observations      text,
  extra_fields      jsonb         NOT NULL DEFAULT '{}'::jsonb,
  created_by        uuid,
  created_at        timestamptz   NOT NULL DEFAULT now(),
  updated_at        timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT employee_files_document_number_unique UNIQUE (document_number)
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS employee_files_employee_idx
  ON employee_files(employee_id);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS employee_files_correlative_idx
  ON employee_files(type_id, subtype_id, document_year, document_sequence);
--> statement-breakpoint

-- ─── Adjuntos ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS employee_file_attachments (
  id               uuid          DEFAULT gen_random_uuid() PRIMARY KEY,
  employee_file_id uuid          NOT NULL REFERENCES employee_files(id) ON DELETE CASCADE,
  label            varchar(60)   NOT NULL DEFAULT 'adjunto',
  file_path        varchar(500)  NOT NULL,
  original_name    varchar(255)  NOT NULL,
  mime_type        varchar(100)  NOT NULL,
  file_size        integer       NOT NULL,
  uploaded_by      uuid,
  created_at       timestamptz   NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS employee_file_attachments_file_idx
  ON employee_file_attachments(employee_file_id);
--> statement-breakpoint

-- ─── Seed: tipos ──────────────────────────────────────────────────────────
-- 13 tipos canónicos del documento de referencia. Los `code` son
-- snake-case y deben coincidir con `dynamic-fields.ts` en la API.
INSERT INTO employee_file_types (code, name, sort_order) VALUES
  ('estudios_academicos',    'Estudios Académicos',         1),
  ('capacitacion',           'Capacitación',                2),
  ('permisos',               'Permisos',                    3),
  ('amonestaciones',         'Amonestaciones',              4),
  ('movimiento_personal',    'Movimiento de Personal',      5),
  ('evaluacion_desempeno',   'Evaluación de Desempeño',     6),
  ('vacaciones',             'Vacaciones',                  7),
  ('tiempo_compensatorio',   'Tiempo Compensatorio',        8),
  ('documento',              'Documento',                   9),
  ('experiencia',            'Experiencia',                10),
  ('licencias_con_sueldo',   'Licencias con Sueldo',       11),
  ('licencias_sin_sueldo',   'Licencias sin Sueldo',       12),
  ('licencias_especiales',   'Licencias Especiales',       13)
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, sort_order = EXCLUDED.sort_order;
--> statement-breakpoint

-- ─── Seed: subtipos ──────────────────────────────────────────────────────
-- 60 subtipos en total, agrupados por tipo. Los códigos son
-- snake-case dentro del tipo, así que `(type_id, code)` es único.
INSERT INTO employee_file_subtypes (type_id, code, name, sort_order)
SELECT t.id, s.code, s.name, s.sort_order
FROM employee_file_types t
JOIN (VALUES
  -- 1. Estudios Académicos
  ('estudios_academicos', 'diplomado',         'Diplomado',                1),
  ('estudios_academicos', 'tecnico',           'Técnico',                  2),
  ('estudios_academicos', 'maestria',          'Maestría',                 3),
  ('estudios_academicos', 'bachiller',         'Bachiller',                4),
  ('estudios_academicos', 'ingenieria',        'Ingeniería',               5),
  ('estudios_academicos', 'derecho_admin',     'En Derecho Administrativo',6),
  ('estudios_academicos', 'primaria',          'Primaria',                 7),
  ('estudios_academicos', 'licenciatura',      'Licenciatura',             8),
  ('estudios_academicos', 'doctorado',         'Doctorado',                9),
  ('estudios_academicos', 'profesorado',       'Profesorado',             10),
  ('estudios_academicos', 'post_grado',        'Post Grado',              11),
  ('estudios_academicos', 'no_especificado',   'No Especificado',         12),
  ('estudios_academicos', 'primer_ciclo',      'Primer Ciclo',            13),
  -- 2. Capacitación
  ('capacitacion', 'curso',     'Curso',     1),
  ('capacitacion', 'charla',    'Charla',    2),
  ('capacitacion', 'taller',    'Taller',    3),
  ('capacitacion', 'jornada',   'Jornada',   4),
  ('capacitacion', 'seminario', 'Seminario', 5),
  -- 3. Permisos
  ('permisos', 'otros',                'Otros',                       1),
  ('permisos', 'enfermedad',           'Enfermedad',                  2),
  ('permisos', 'eventos_academicos',   'Eventos Académicos',          3),
  ('permisos', 'mision_oficial',       'Misión Oficial',              4),
  ('permisos', 'nacimiento',           'Nacimiento',                  5),
  ('permisos', 'duelo',                'Duelo',                       6),
  ('permisos', 'asuntos_personales',   'Otros asuntos personales',    7),
  ('permisos', 'representacion_gremial','Representación Gremial',     8),
  ('permisos', 'cita_medica',          'Cita Médica',                 9),
  ('permisos', 'matrimonio',           'Matrimonio',                 10),
  -- 4. Amonestaciones
  ('amonestaciones', 'escrita', 'Escrita', 1),
  ('amonestaciones', 'verbal',  'Verbal',  2),
  -- 5. Movimiento de Personal
  ('movimiento_personal', 'asignacion',                'Asignación',                1),
  ('movimiento_personal', 'designacion',               'Designación',               2),
  ('movimiento_personal', 'traslado',                  'Traslado',                  3),
  ('movimiento_personal', 'prestamo_interinst',        'Préstamo Interinstitucional',4),
  -- 6. Evaluación de Desempeño
  ('evaluacion_desempeno', 'bueno',           'Bueno',           1),
  ('evaluacion_desempeno', 'no_satisfactorio','No Satisfactorio',2),
  ('evaluacion_desempeno', 'excelente',       'Excelente',       3),
  ('evaluacion_desempeno', 'regular',         'Regular',         4),
  -- 7. Vacaciones
  ('vacaciones', 'accion_aumenta',       'Acción de Personal (AUMENTA)',    1),
  ('vacaciones', 'inicializacion',       'Inicialización Período',          2),
  ('vacaciones', 'resuelto_normal',      'Resuelto Normal',                 3),
  ('vacaciones', 'accion_disminuye',     'Acción de Personal (DISMINUYE)',  4),
  ('vacaciones', 'migracion_periodo',    'Migración Período',               5),
  ('vacaciones', 'resuelto_especial',    'Resuelto Especial',               6),
  -- 8. Tiempo Compensatorio
  ('tiempo_compensatorio', 'aumenta',   'Aumenta',   1),
  ('tiempo_compensatorio', 'disminuye', 'Disminuye', 2),
  -- 9. Documento
  ('documento', 'licencia',   'Licencia',   1),
  ('documento', 'cedula_ruc', 'Cédula/RUC', 2),
  -- 10. Experiencia
  ('experiencia', 'trabajo_realizado', 'Trabajo Realizado', 1),
  ('experiencia', 'labor_realizada',   'Labor Realizada',   2),
  -- 11. Licencias con Sueldo
  ('licencias_con_sueldo', 'representacion_institucional', 'Representación de la Institución, Estado o País', 1),
  ('licencias_con_sueldo', 'estudios',                     'Estudios',                                         2),
  ('licencias_con_sueldo', 'representacion_asociacion',    'Representación de la asociación de servidor',     3),
  ('licencias_con_sueldo', 'capacitacion',                 'Capacitación',                                     4),
  ('licencias_con_sueldo', 'razones_extraordinarias',      'RAZONES EXTRAORDINARIAS',                          5),
  -- 12. Licencias sin Sueldo
  ('licencias_sin_sueldo', 'cargo_eleccion_popular',       'Asumir cargo de elección popular',                1),
  ('licencias_sin_sueldo', 'asuntos_personales',           'Asuntos Personales',                              2),
  ('licencias_sin_sueldo', 'libre_nombramiento',           'Asumir cargo de libre nombramiento y remoción',   3),
  ('licencias_sin_sueldo', 'estudiar',                     'Estudiar',                                        4),
  -- 13. Licencias Especiales
  ('licencias_especiales', 'enfermedad_profesional',       'Enfermedad Profesional',                          1),
  ('licencias_especiales', 'incapacidad_15dias',           'Enfermedad/Incapacidad superior quince días',     2),
  ('licencias_especiales', 'riesgos_profesionales',        'Riesgos Profesionales',                           3),
  ('licencias_especiales', 'gravidez',                     'Gravidez',                                        4)
) s(type_code, code, name, sort_order) ON s.type_code = t.code
ON CONFLICT (type_id, code) DO UPDATE SET name = EXCLUDED.name, sort_order = EXCLUDED.sort_order;
