-- Flag `requires_approval` en el catálogo de subtipos de expediente.
--
-- Sustituye la heurística "si hay rule activa para el (tipo,subtipo)
-- el expediente nace pending" por una bandera explícita declarada en
-- el subtipo. La regla `employee_file_approval_rules` deja de ser el
-- gate y pasa a ser solamente quién (qué rol) puede aprobar.
--
-- Comportamiento resultante:
--   subtype.requires_approval = 0  → file nace 'approved' (auto)
--   subtype.requires_approval = 1  → file nace 'pending'
--      + si hay rule activa, el approver_role manda
--      + si no hay rule, fallback a 'tenant_admin'
--
-- También se agrega `requires_approval` al tipo como hint/default,
-- pero la decisión final se toma a nivel de subtipo (más específico
-- gana). No es enforced por el service hoy — solo UX al crear
-- subtipos nuevos desde el CRUD.

ALTER TABLE employee_file_types
  ADD COLUMN IF NOT EXISTS requires_approval integer NOT NULL DEFAULT 0;
--> statement-breakpoint

ALTER TABLE employee_file_subtypes
  ADD COLUMN IF NOT EXISTS requires_approval integer NOT NULL DEFAULT 0;
--> statement-breakpoint

-- Migrar subtipos existentes que ya tenían rule activa: marcarlos
-- como requires_approval=1 para preservar el comportamiento previo.
UPDATE employee_file_subtypes s
   SET requires_approval = 1
 WHERE EXISTS (
   SELECT 1
   FROM employee_file_approval_rules r
   WHERE r.is_active = 1
     AND r.type_id = s.type_id
     AND (r.subtype_id = s.id OR r.subtype_id IS NULL)
 );
--> statement-breakpoint

-- Reflejar el mismo cambio en el tipo si TODOS sus subtipos requieren
-- aprobación o si tenía una regla type-only (subtype_id IS NULL).
UPDATE employee_file_types t
   SET requires_approval = 1
 WHERE EXISTS (
   SELECT 1 FROM employee_file_approval_rules r
   WHERE r.is_active = 1 AND r.type_id = t.id AND r.subtype_id IS NULL
 );
