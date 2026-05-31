# Extensiones a Empleados y Posiciones — Fase 1 (Diagnóstico y decisiones)

> Estado: **diagnóstico completo, decisiones confirmadas**. No se ha escrito
> código de Fase 2. Este documento es el entregable de la Fase 1 (sección 1.3).

## 1. Inventario del estado actual

### 1.1. `institutionType` (con/sin posiciones) — CONFIRMADO
- `company_config.institution_type` `varchar(20)` default `'privada'`
  (`packages/db/src/schema/company.ts:11`).
- Valores reales: `'privada'` = **empresa sin posiciones**;
  `'publica'` = **empresa con posiciones**. No hay enum formal, se compara
  contra literales.
- Ya gobierna comportamiento:
  - UI empleado: `publica` muestra selector de **posición** y salario
    readonly; `privada` muestra departamento/cargo/función y salario editable
    (`apps/web/src/pages/employees/[id].astro:575-668`, `new.astro`).
  - Motor de planilla: en `publica` con `positionId`, el salario efectivo se
    toma de `positions.salary`, **sobrescribiendo** `employees.baseSalary`
    (`apps/api/src/modules/payroll/service.ts:269, 381-387, 689-691`).

### 1.2. Schema `positions` — sobre qué se extiende
`packages/db/src/schema/positions.ts`: `id, code, name, salary(varchar),
jobTitleId, departmentId, jobFunctionId, budgetItemId, isActive,
status(varchar default 'vacante'), createdAt, updatedAt`.
→ **No** existen `overtime_amount`, `representation_amount`, ni partidas por
concepto. `jobFunctionId` y `budgetItemId` (base) **ya existen**.

### 1.3. Schema `employees` — dónde encajan los campos nuevos
`packages/db/src/schema/employee.ts`. Hallazgos relevantes:
- **Ya existen**: `photo` (text), `scannedId` (text), `jobFunctionId` (uuid),
  `customFields` (jsonb), `baseSalary` (varchar notNull), `positionId`,
  `jobTitleId`, `departmentId`.
- **Faltan**: `has_own_disability`, `requires_attendance_marking`,
  `can_read`, `can_write`.
→ Los campos nuevos van en columnas propias (no en `customFields`), siguiendo
el patrón existente.

### 1.4. Reconocimiento facial / marcaciones — EXISTE (completo)
`apps/api/src/modules/facial/` (service.ts 619 líneas, routes.ts, vector.ts):
- `facialEnrollments`: `embedding` (jsonb), `qualityScore`, `isPrimary`,
  `status`, `photoUrl`, `enrolledByUserId`.
- Servicios: `createEnrollmentService` (recibe **embedding ya calculado** +
  `photoUrl` opcional), `matchEmbeddingService`, `ingestMarcacionesService`,
  consolidación a `attendance_records`, terminales/kioskos.
- UI de enrolamiento: `apps/web/src/pages/attendance/enroll.astro` → enlaza a
  `/kiosk/setup?enroll=<id>`.
- **Punto clave**: el embedding lo genera la captura del kiosko, **no** el
  base64 guardado en `employees.photo`. No hay generador de embeddings
  server-side a partir del base64.

### 1.5. Discapacidad propia y Dependientes / saldos
- **Saldos** existe y funciona (`apps/api/src/modules/time-balance/`).
  Tipos: `compensatory | disability | family_disability`.
- `disability` (propia) está **cableado pero BLOQUEADO**: falta el campo de
  discapacidad propia en `employees`
  (`time-balance/service.ts:292-294, 321-326, 384`).
- **Dependientes** existe y está completo: tabla `dependents` con
  `has_disability` + UI ("Dependientes" en `[id].astro`) +
  `syncFamilyDisability` que llama a `syncConditionalBalance(...,
  'family_disability', ...)` en cada alta/baja
  (`apps/api/src/modules/employees/dependents-routes.ts`). → **El enganche de
  la Fase 2.E ya está implementado.**

## 2. Decisiones confirmadas (sección 1.2 del brief)

| # | Decisión | Resolución confirmada |
|---|---|---|
| A | Salario editable con tope | **baseSalary editable; tope = `positions.salary`; validación Zod (`baseSalary <= positions.salary`) + helper con el máximo. El motor de planilla pasa a usar `employees.baseSalary` (capado) en `publica`, en vez de `positions.salary`.** |
| B | Sobresueldo / gastos de representación | Naturaleza fiscal **pendiente** de especialista en planilla PA. Se almacenan montos en `positions`; **no** se toca el motor de planilla. |
| C | Partidas por concepto | **4 columnas en `positions`**: `budget_item_id` (existe) + `overtime_budget_item_id` + `representation_budget_item_id` + `thirteenth_month_budget_item_id`. |
| D | Ubicación de la función | **Por empleado**: mantener `employees.jobFunctionId` (ya existe), eliminar `positions.jobFunctionId`, backfill desde la posición. Dos empleados en la misma posición pueden tener funciones distintas. |
| E | "Marca Reloj" | `requires_attendance_marking` boolean default `true`. |
| F | Foto ↔ enrolamiento | **(A)** Almacenar foto como referencia visual; enrolamiento sigue por el kiosko. Documentar el punto de integración futura. |

## 3. Modelo de datos propuesto

### `positions` (migración tenant)
```
+ overtime_amount            varchar(20)  default '0'
+ representation_amount      varchar(20)  default '0'
+ overtime_budget_item_id    uuid         (FK tenant, sin .references())
+ representation_budget_item_id uuid
+ thirteenth_month_budget_item_id uuid
- job_function_id            (eliminar; pasa a employees)
```

### `employees` (migración tenant)
```
+ has_own_disability          boolean default false
+ requires_attendance_marking boolean default true
+ can_read                    boolean default false
+ can_write                   boolean default false
(photo, scanned_id, job_function_id YA existen)
Backfill: job_function_id ← posición asignada (donde positionId no nulo y la
columna del empleado esté vacía).
```

## 4. Plan por fases (un commit por fase)

- **2.A** Comportamientos condicionales por `institutionType` (listado con
  columnas *partida* y *número de posición*; salario editable con tope + Zod;
  bloque solo-lectura de la posición en el form). Incluye el cambio de
  resolución de salario en `payroll/service.ts` (decisión A).
  `feat(employees): conditional fields for institutionType with positions`
- **2.B** `overtime_amount`, `representation_amount` + 3 partidas por concepto
  en `positions` (migración + form + validación de partidas activas). No
  tocar motor de planilla.
  `feat(positions): overtime, representation, budget items per concept`
- **2.C** Función al empleado: eliminar `positions.jobFunctionId`, backfill,
  ajustar ambos formularios.
  `refactor(employees): move job function from position to employee`
- **2.D** Flags personales (`has_own_disability`,
  `requires_attendance_marking`, `can_read`, `can_write`) + wiring de
  `photo`/`scanned_id` en el form "Datos personales" con validación
  MIME/tamaño. `has_own_disability` activa `syncConditionalBalance(...,
  'disability', ...)` (desbloquea el saldo de discapacidad propia).
  `feat(employees): personal flags + photo + scanned ID`
- **2.E** Familiar con discapacidad → saldo. **Ya implementado** vía
  `syncFamilyDisability`. Solo verificar/confirmar; probablemente sin commit
  nuevo salvo ajustes menores.
- **2.F** Foto ↔ enrolamiento: dejar foto almacenada + documentar punto de
  integración (decisión A/F).
  `docs(employees): photo ready for future face enrollment integration`

## 5. Pendientes / dependencias declaradas
- Naturaleza fiscal de sobresueldo y gastos de representación (decisión B):
  trabajo del módulo de planilla, requiere validación con especialista PA.
- Generación de embedding server-side desde `employees.photo`: no existe;
  el enrolamiento sigue dependiendo del kiosko.
