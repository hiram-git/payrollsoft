# Validación — Creación de Empresa (Tenant)

> Guía de pruebas para validar el flujo de aprovisionamiento de una empresa
> desde el wizard `/superadmin/tenants/new`, incluyendo los seeds base y los
> seeds opcionales (Empleados / Préstamos-Acreedores).

- **Módulo:** Super Admin · Empresas (tenants)
- **Ruta UI:** `/superadmin/tenants/new`
- **Última actualización:** 2026-06-15

---

## 1. Objetivo

Verificar que al crear una empresa se aprovisione correctamente su esquema
(`tenant_<slug>`), se apliquen los datos base (roles, permisos, usuario admin,
configuración y conceptos) y, cuando se marquen, los seeds opcionales de
empleados y préstamos/acreedores — dejando la empresa en estado `ACTIVE` y
utilizable.

## 2. Alcance

- ✅ Aprovisionamiento base (siempre): schema, migraciones, roles, admin, company_config, conceptos por defecto.
- ✅ Seed opcional **Empleados** (catálogos + empleados de prueba).
- ✅ Seed opcional **Préstamos** (acreedores + préstamos + cuotas). Requiere Empleados.
- ✅ Casos negativos (slug duplicado/ inválido, contraseña débil, email inválido).
- ❌ Fuera de alcance: generación de planillas y reportes (flujo aparte).

## 3. Prerrequisitos

- [ ] Sesión iniciada como **Super Admin** (`/superadmin/login`).
- [ ] API levantada y **reiniciada con el código actual** (importante: si corre el bundle de producción, recompilar `apps/api`; si corre `bun --watch`, **no editar archivos durante la creación**, porque el reinicio aborta el aprovisionamiento a medias).
- [ ] Acceso a la base de datos para las verificaciones SQL (psql / cliente).
- [ ] Un `slug` libre para la prueba (ej. `acme-test`). Si reusas uno, elimínalo primero (ver §9).

## 4. Arquitectura del flujo (referencia)

```
Wizard (3 pasos)            →  proxy web                       →  API                         →  provisionTenant (@payroll/db)
/superadmin/tenants/new        /api/superadmin/tenants/create     POST /superadmin/tenants        1. valida slug (rechaza si existe)
  Paso 1: Empresa              (mapea checkboxes de seed)          (valida + reenvía seeds)        2. CREATE SCHEMA tenant_<slug>
  Paso 2: Administrador                                                                            3. corre TODAS las migraciones tenant
  Paso 3: Confirmación + seeds                                                                     4. seed base: roles+permisos, admin, company_config, conceptos
                                                                                                   5. seeds opcionales: empleados, préstamos
                                                                                                   6. status = ACTIVE + marcadores en metadata.seeds
```

**Datos base esperados tras el aprovisionamiento (sin seeds opcionales):**

| Tabla (en `tenant_<slug>`) | Esperado | Origen |
|---|---|---|
| `roles` | **4** (`tenant_admin`, `hr`, `accountant`, `viewer`) | seed base |
| `users` | **1** (admin del wizard, `is_tenant_admin=true`) | seed base |
| `user_roles` | **1** (admin → tenant_admin) | seed base |
| `company_config` | **1** | seed base |
| `concepts` | **10** (HORAS_EXTRAS, COMISIONES, BONIFICACIONES, XIII_MES, ISLR, SUELDO, SS, SE, SSP, SEP) | seed base |
| `concept_payroll_types` | **4** (regular, contingente, transitorio, servicios_profesionales) | migración `0006` |
| `job_titles` / `job_functions` / `departments` | **0** | *no* se siembran en base (solo con el seed de Empleados) |

---

## 5. Casos de prueba

### CP-01 — Creación mínima (sin seeds opcionales)

**Pasos**
1. Ir a `/superadmin/tenants/new`.
2. **Paso 1 (Empresa):** nombre = `ACME Test`, identificador (slug) = `acme-test`, verificar que el slug aparezca **disponible**. Continuar.
3. **Paso 2 (Administrador):** nombre, email (`admin@acme.test`), contraseña ≥ 12 caracteres. Continuar.
4. **Paso 3 (Confirmación):** **no** marcar ningún seed. Confirmar la creación.

**Resultado esperado**
- [ ] Modal de éxito “La empresa fue aprovisionada correctamente”.
- [ ] Redirige a `/superadmin/tenants/acme-test` con estado **ACTIVE**.
- [ ] En la lista `/superadmin/tenants` aparece con badge **Abierta/Activo**.
- [ ] Verificación SQL (§6): roles=4, users=1, company_config=1, concepts=10, concept_payroll_types=4.
- [ ] `metadata.seeds` está **vacío** (no se marcaron seeds).

---

### CP-02 — Creación con seed de **Empleados**

**Pasos**
1. Igual que CP-01 pero con slug nuevo (ej. `acme-emp`).
2. En el **Paso 3**, marcar **Empleados** y dejar la cantidad (por defecto **200**, o usar un número menor como **20** para una prueba rápida).
3. Confirmar.

**Resultado esperado**
- [ ] Empresa **ACTIVE**.
- [ ] `metadata.seeds.employees` con `applied_at` y `stats` (ej. `total`, `inserted`).
- [ ] Verificación SQL: `employees` = la cantidad indicada; `job_functions ≥ 3`, `job_titles ≥ 4`, `departments ≥ 4` (el seed **crea** los catálogos base si faltan).
- [ ] Cada empleado queda ligado a un tipo de planilla (`employee_payroll_types`).

> Nota: el seed de Empleados es el que crea cargos/funciones/departamentos demo
> cuando la empresa aún no los tiene.

---

### CP-03 — Creación con **Empleados + Préstamos** (acreedores)

**Pasos**
1. Igual que CP-02 con slug nuevo (ej. `acme-full`).
2. En el **Paso 3**, marcar **Empleados** (ej. 20). Al marcar Empleados se **habilita** el checkbox **Préstamos**; márcalo también.
3. Confirmar.

**Resultado esperado**
- [ ] Empresa **ACTIVE**.
- [ ] `metadata.seeds.employees` y `metadata.seeds.loans` ambos con `applied_at`.
- [ ] Verificación SQL: `creditors` = **10** (acreedores), `concepts` = **20** (10 base + 10 `ACR_*`), `loans > 0`, `loan_installments > 0`.

> Importante: **los acreedores SOLO se crean con el seed de Préstamos.** Marcar
> únicamente “Empleados” no genera acreedores (es por diseño). Préstamos exige
> Empleados (no se puede prestar sin empleados).

---

### CP-04 — Casos negativos

| ID | Escenario | Acción | Resultado esperado |
|---|---|---|---|
| CP-04a | **Slug duplicado** | Crear con un slug ya existente (cualquier estado, incluso ARCHIVED) | Error “Ese identificador ya está en uso”. **No** se crea. |
| CP-04b | **Slug inválido** | Slug con mayúsculas/espacios/caracteres no permitidos | Error “El identificador no es válido…”. Botón bloqueado en Paso 1. |
| CP-04c | **Contraseña débil** | Contraseña < 12 caracteres | Error “La contraseña debe tener al menos 12 caracteres”. |
| CP-04d | **Email admin inválido** | Email sin `@` o mal formado | Error “El correo del administrador no es válido”. |
| CP-04e | **Campos obligatorios** | Dejar nombre/slug/admin vacíos | El wizard no deja avanzar (validación por paso). |

---

## 6. Verificaciones en base de datos (SQL)

> Reemplaza `acme-test` por tu slug. **Ojo con el guion:** el nombre del schema
> (`tenant_acme-test`) debe ir entre **comillas dobles** en SQL.

**6.1 Estado central del tenant y marcadores de seed**
```sql
SELECT slug, status, database_schema,
       metadata->'seeds'->'employees' AS seed_employees,
       metadata->'seeds'->'loans'     AS seed_loans
  FROM payroll_auth.tenants
 WHERE slug = 'acme-test';

-- Provisioning bookkeeping
SELECT state, error, started_at, finished_at
  FROM payroll_auth.tenant_provisioning tp
  JOIN payroll_auth.tenants t ON t.id = tp.tenant_id
 WHERE t.slug = 'acme-test';
```
- `status` = `ACTIVE`, `tenant_provisioning.state` = `done`, `error` = NULL.
- Si un seed falló, `metadata.seeds.<kind>` tendrá `failed_at` + `error` (no `applied_at`).

**6.2 Conteos dentro del schema del tenant**
```sql
SET search_path TO "tenant_acme-test", payroll_auth, public;

SELECT 'roles'                AS tabla, count(*) FROM roles
UNION ALL SELECT 'users',                count(*) FROM users
UNION ALL SELECT 'company_config',       count(*) FROM company_config
UNION ALL SELECT 'concepts',             count(*) FROM concepts
UNION ALL SELECT 'concept_payroll_types',count(*) FROM concept_payroll_types
UNION ALL SELECT 'job_titles',           count(*) FROM job_titles
UNION ALL SELECT 'job_functions',        count(*) FROM job_functions
UNION ALL SELECT 'departments',          count(*) FROM departments
UNION ALL SELECT 'employees',            count(*) FROM employees
UNION ALL SELECT 'creditors',            count(*) FROM creditors
UNION ALL SELECT 'loans',                count(*) FROM loans
UNION ALL SELECT 'loan_installments',    count(*) FROM loan_installments;

RESET search_path;
```

**6.3 Conceptos por defecto presentes (validar que no falten)**
```sql
SET search_path TO "tenant_acme-test", payroll_auth, public;
SELECT code FROM concepts WHERE code IN
  ('HORAS_EXTRAS','COMISIONES','BONIFICACIONES','XIII_MES','ISLR','SUELDO','SS','SE','SSP','SEP')
 ORDER BY code;
-- Esperado: las 10 filas.
RESET search_path;
```

**6.4 Roles y admin**
```sql
SET search_path TO "tenant_acme-test", payroll_auth, public;
SELECT code, is_system FROM roles ORDER BY code;          -- 4 roles, is_system=true
SELECT email, role, is_tenant_admin, is_active FROM users; -- admin del wizard
RESET search_path;
```

---

## 7. Checklist resumen

- [ ] Wizard valida slug disponible en Paso 1.
- [ ] Wizard valida email/contraseña en Paso 2.
- [ ] Paso 3 muestra resumen y seeds opcionales; “Préstamos” se habilita solo con “Empleados”.
- [ ] Empresa queda **ACTIVE** y `tenant_provisioning.state = done`.
- [ ] Datos base: roles=4, users=1, company_config=1, concepts=10, concept_payroll_types=4.
- [ ] Seed Empleados (si aplica): catálogos creados + N empleados + `metadata.seeds.employees.applied_at`.
- [ ] Seed Préstamos (si aplica): creditors=10, concepts=20, loans/installments > 0 + `metadata.seeds.loans.applied_at`.
- [ ] Casos negativos rechazados con mensaje claro y sin crear empresa.
- [ ] Ningún seed quedó en `failed_at` inesperadamente.

---

## 8. Problemas conocidos / correcciones recientes

- **Catálogos base para el seed de Empleados:** el aprovisionamiento base no
  siembra `job_titles/job_functions/departments`; el seed de Empleados ahora los
  crea automáticamente si faltan (antes lanzaba error y el seed no se aplicaba).
- **Aprovisionamiento colgado:** la conexión de provisión ahora usa una sola
  conexión + `lock_timeout`/`statement_timeout`, de modo que un bloqueo en BD
  **falla rápido y queda registrado** (`metadata.seeds.*.error`) en vez de
  colgarse indefinidamente con la empresa atascada en `PROVISIONING`.
- **`bun --watch`:** evita editar archivos del proyecto **mientras** se crea una
  empresa; el reinicio del proceso aborta el aprovisionamiento a medias y puede
  dejar un schema parcial y locks huérfanos.
- **Archivar ≠ eliminar:** el botón “Archivar” es soft-delete; **no** libera el
  slug ni borra el schema. Para reusar un slug hay que eliminar físicamente (§9).

---

## 9. Limpieza (rollback de una empresa de prueba)

> Libera el slug y borra el schema + la fila central. **Irreversible** — haz
> backup si hay datos que te importen.

```sql
-- 1) Confirma el nombre exacto del schema
SELECT slug, database_schema, status
  FROM payroll_auth.tenants WHERE slug = 'acme-test';

-- 2) (Opcional) si quedó atascada en PROVISIONING, libera conexiones bloqueadas
SELECT pg_terminate_backend(pid)
  FROM pg_stat_activity
 WHERE datname = current_database() AND state = 'idle in transaction';

-- 3) Borra el schema (comillas dobles por el guion) y la fila central
DROP SCHEMA IF EXISTS "tenant_acme-test" CASCADE;     -- usa el database_schema del paso 1
DELETE FROM payroll_auth.tenants WHERE slug = 'acme-test';
```

---

## 10. Registro de ejecución (plantilla)

| Caso | Fecha | Slug | Resultado | Observaciones |
|---|---|---|---|---|
| CP-01 | | | ⬜ OK / ⬜ Falla | |
| CP-02 | | | ⬜ OK / ⬜ Falla | |
| CP-03 | | | ⬜ OK / ⬜ Falla | |
| CP-04a | | | ⬜ OK / ⬜ Falla | |
| CP-04b | | | ⬜ OK / ⬜ Falla | |
| CP-04c | | | ⬜ OK / ⬜ Falla | |
| CP-04d | | | ⬜ OK / ⬜ Falla | |
