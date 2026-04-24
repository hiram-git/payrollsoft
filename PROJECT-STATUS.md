# Estado del Proyecto — PayrollSoft

**Última actualización:** 23 de abril de 2026 (sesión 3 — feedback independiente por botón en `/payroll/[id]`)
**Branch activo:** `claude/refactor-payroll-pdf-landscape-vu25U`

## Avance de la sesión 3 (23/04/2026) — Feedback independiente por botón en el dropdown de Reportes

Refactor del dropdown "Reportes" en `/payroll/[id]` para que cada acción
(Generar / Descargar / Regenerar) maneje su propio estado de carga sin
bloquear ni afectar al resto de los botones de la vista:

- **Eliminado el modal bloqueante** (`report-modal`) que anteriormente
  oscurecía toda la pantalla durante una generación. Ya no hay
  `body.overflow=hidden`, así que las acciones de la vista (Cerrar
  planilla, Reabrir, Eliminar, Regenerar planilla, etc.) siguen
  operativas durante una regeneración del PDF.
- **Spinner inline por ítem**: cada `<button>` del dropdown lleva dos
  íconos (estático + busy) que se intercambian con `.hidden` cuando ese
  botón específico entra en busy. La etiqueta también cambia
  ("Generar" → "Generando…", "Regenerar" → "Regenerando…",
  "Descargar" → "Descargando…").
- **Aislamiento real**: helper `controllerFor(action, defaultLabel,
  busyLabel)` por botón, que expone `setVisible / setBusy / setEnabled
  / showError`. Sólo el botón clicado se deshabilita; los demás
  permanecen interactivos. El trigger del dropdown tampoco se
  deshabilita.
- **Errores localizados**: si la generación falla, el mensaje aparece
  bajo el botón que disparó la acción (vía `data-row-error`), no en un
  cartel global.
- La visibilidad sigue dictada por la máquina de estados:
  `not_generated` muestra Generar; `generated` muestra Descargar +
  Regenerar. La descarga incluye una breve señal visual (1.5 s)
  porque la navegación al endpoint la hace el navegador.

## Avance previo de la sesión 3 — Hook unificado `usePayrollReport`

Consolida la lógica de la máquina de estados del reporte en un único
composable reutilizable por la vista de detalle y el listado:

- **`apps/web/src/lib/reports/use-payroll-report.ts`** — factory
  `usePayrollReport({ payrollId, stateUrl, generateUrl, regenerateUrl,
  downloadUrl })` que devuelve `{ getState, subscribe, refresh, generate,
  regenerate, download, urls }`. Estados: `loading | idle | busy | error`
  (con `lastSnapshot` durante busy/error para preservar los controles).
  Helper `payrollReportUrls(id)` expone los paths canónicos.
- **Listado `/reports/payroll`** — cada fila crea su propio controller,
  con estado independiente (busy en un reporte no bloquea los demás).
  La tabla ahora lista sólo planillas en estado `generated|closed` y
  **filtra por el tipo seleccionado en el navbar** reenviando
  `payrollTypeId` (cookie `payroll.activeTypeId`) al endpoint
  `/payroll?payrollTypeId=...`.
- **Vista de detalle `/payroll/[id]`** — botones dispersos (Generar
  / Descargar / Regenerar) sustituidos por un **dropdown "Reportes"**
  único con las 3 opciones. El dropdown queda separado del botón
  "Regenerar planilla" (máquina de estados de la planilla, no del PDF),
  clarificando la diferencia entre gestión de archivo y recálculo.
- La descarga Excel queda como botón secundario al lado del dropdown —
  corresponde a un archivo que sí se puede descargar inmediatamente.
- Modal bloqueante y spinner se disparan sólo cuando el estado entra en
  `busy`; se cierran automáticamente al volver a `idle` o `error`.

## Avance previo de la sesión 3 — Optimización de préstamos

## Avance de la sesión 3 (23/04/2026) — Optimización de préstamos

Desnormaliza los préstamos dentro de `payroll_lines.concepts` para que la
lectura del reporte no necesite volver a unir `loans` + `creditors`:

- **Eliminado el JOIN** en `bulkLoadCreditorInstallments`. Antes hacía
  `loans INNER JOIN creditors` en la misma query; ahora dispara dos
  queries independientes (`loans` + `creditors IN (ids)`), agrega en
  JS y devuelve:
  `{ byEmployee: Map<empId, Map<creditorCode, aggregate>>, creditorsByCode }`
  donde el agregado incluye `{ creditorId, creditorCode, creditorName,
  installment, loanIds[] }`.
- **Nueva llave `other_discounts`** por entrada de concepto creditor-
  linked en `payroll_lines.concepts`. `LineConceptEntry` gana un campo
  opcional:
  ```ts
  other_discounts?: {
    loan_ids: string[]
    creditor_id: string
    creditor_code: string
    creditor_name: string
  }
  ```
  Lo escribe el servicio después de `processLine()` vía el helper
  `stampOtherDiscounts` (tanto en generación bulk como en regeneración
  por empleado). Permite a cualquier reporte localizar al préstamo y al
  acreedor leyendo solamente `payroll_lines`.
- **PDF actualizado**: la columna "Otras Ded." ahora sumatoria los
  conceptos con `other_discounts` (fallback al prefijo `ACR_` para filas
  legadas generadas antes del refactor).
- Tests de `@payroll/core` — 77/77 pass sin cambios.

## Avance previo de la sesión 3 — State machine de Planilla PDF

## Avance de la sesión 3 (23/04/2026) — State machine de Planilla PDF

El reporte PDF ahora vive como un recurso persistente con máquina de estados
mínima de dos estados (`not_generated` / `generated`):

- **Nueva tabla `payroll_reports`** en el schema tenant — migración
  `0019_payroll_reports.sql`. Campos: `id`, `payroll_id` (UNIQUE),
  `status`, `pdf_path`, `generated_at`, `updated_at`, `generated_by`.
- **Query helpers** (`packages/db/src/query-builder.ts`):
  `getPayrollReport`, `markPayrollReportGenerated` (upsert),
  `markPayrollReportNotGenerated`.
- **Rutas Elysia** en `payrollRoutes`:
  - `GET /payroll/:id/report` — devuelve `{ status, pdfPath, generatedAt, ... }`
    (lazy: `not_generated` si no existe fila).
  - `POST /payroll/:id/report` — marca como `generated`, recibe `{ pdfPath }`
    en el body; grabado por el proceso web que acaba de escribir el archivo.
  - `POST /payroll/:id/report/regenerate` — flip atómico a `not_generated`.
- **Storage en disco** (`apps/web/src/lib/reports/payroll-report-storage.ts`):
  el layout sugerido por el spec — `{STORAGE_DIR}/{tenant}_storage/reports/
  payroll/{payrollId}/report.pdf`. `STORAGE_DIR` es configurable por env.
- **Endpoints Astro**:
  - `POST /api/reports/payroll/:id/generate` — renderiza PDF, escribe a
    disco, persiste el estado vía API. Único camino que escribe archivos.
  - `POST /api/reports/payroll/:id/regenerate` — flip a `not_generated` en
    API y re-despacha a `/generate` para mantener una sola vía de render.
  - `GET /api/reports/payroll/:id/download` — lee estado, lee archivo de
    disco, devuelve el PDF con filename amable.
  - `GET /api/reports/payroll/:id/state` — proxy del estado para el cliente.
  - Las rutas legacy `/api/payroll/:id/pdf` y `/api/reports/payroll/:id/pdf`
    redirigen (307) a `/download` para no romper bookmarks.
- **UI en `/payroll/[id]`**:
  - Server-side fetch del estado. Si `not_generated`: botón "Generar PDF";
    si `generated`: "Descargar" (primario) + "Regenerar" (secundario).
  - Modal bloqueante con spinner — "Generando reporte de planilla, por
    favor espere…" — con `body.overflow` bloqueado durante la operación.
    Los botones se deshabilitan; errores se muestran en el mismo modal.
- **Renderer consolidado** (`payroll-pdf-renderer.ts`): único punto de
  entrada (`renderPayrollPdfBuffer`) que devuelve bytes. Elimina la
  duplicación entre legacy pdf.ts y la nueva generate.ts.
- Se mantiene sólo la versión más reciente del PDF en disco — cada
  regeneración sobreescribe el mismo archivo.

## Avance previo de la sesión 3 — Planilla PDF oficial

Segunda iteración sobre el módulo de reportes. El componente `PayrollPdf`
se reescribió para cumplir el formato oficial de "Planilla de Sueldos":

- **A4 horizontal** (antes LETTER), sin tope de 50 empleados — el fetcher
  pide la planilla completa en **una sola petición** (`linesLimit=100000`);
  el cap del query builder se elevó de 200 a 100000 para permitirlo.
  Antes hacíamos N round-trips paginados, lo que en logs parecía un
  ciclo repetitivo.
- **Encabezado**: logo (placeholder), nombre de empresa, `PLANILLA <TIPO>`,
  línea `Desde DD-MM-YYYY hasta DD-MM-YYYY`.
- **Tabla de 10 columnas**: Empleado, Cédula (`employees.id_number`),
  Sueldo, Ingresos, Seg. Social, Seg. Edu., SIACAP, ISR/ISLR, Otras Ded.,
  Neto. La columna "Otras Ded." contiene **sólo cuotas de acreedores**,
  detectadas por el prefijo `ACR_` que emite `createCreditorService`.
  Las deducciones fuera del set legal y no vinculadas a acreedores se
  omiten del reporte intencionalmente para cumplir el spec oficial.
  El Neto se deriva como `Ingresos − (SS + SE + SIACAP + ISR + Otras Ded.)`.
- **Header limpio**: se eliminó el bloque superior derecho (etiqueta
  "Planilla", metadatos de pago y contador de empleados); el título queda
  visualmente centrado gracias a un spacer que balancea el logo.
- **Fila de TOTALES** con la suma de cada columna numérica.
- **Tres firmas**: Elaboración / Revisión / Autorización. Nombres y cargos
  desde `company_config` cuando existen.
- **Footer fijo**: "Generado: fecha+hora" + "Página X de Y".
- **Filtros propagados**: el botón "Planilla PDF" de `/payroll/[id]`
  construye el `href` con los `search` / `department` / `employeeIds` /
  `payrollTypeId` actuales. La cookie `payroll.activeTypeId` actúa como
  fallback. Ambas rutas (`/api/payroll/:id/pdf` y
  `/api/reports/payroll/:id/pdf`) comparten `parsePayrollReportFilters` +
  `fetchPayrollReportData` + `renderPayrollPdfResponse`.
- **DB**: `getPayrollLines` / `getPayrollLinesPaged` ahora devuelven
  `employee.idNumber` (cédula panameña) para la columna correspondiente.

## Avance previo de la sesión 3 — Módulo de Reportes de Planilla

- ✅ **Refactorización de la generación de PDF** a una capa de reportes
  reutilizable (`apps/web/src/lib/reports/`): data-fetcher único
  (`payroll-data.ts`), renderer compartido (`payroll-pdf-renderer.ts`) y
  catálogo declarativo de reportes (`registry.ts`).
- ✅ **Nueva vista `/reports/payroll`** que lista sólo planillas con estado
  `generated` o `closed`, con búsqueda, paginación y un dropdown "Reportes"
  por fila que expone las 6 opciones acordadas.
- ✅ **Planilla PDF en formato horizontal** queda disponible desde:
  (a) botón primario "Planilla PDF" en `/payroll/[id]`;
  (b) dropdown de la vista `/reports/payroll`.
- ✅ **Nuevo endpoint canónico** `/api/reports/payroll/:id/pdf`; la ruta
  previa `/api/payroll/:id/pdf` se conserva y delega al mismo renderer
  para no romper enlaces existentes.
- 🔲 Pendientes declarados en `IMPLEMENTATION-PLAN.md` — Fase 4b: Planilla en
  Excel, Resumen de Planilla, Comprobantes de pago, Envío de comprobantes por
  email, Anexo 09. Cada una aparece en el dropdown como **"Próximamente"**
  (botón deshabilitado) hasta que sea implementada.

---

## Estado General

| Fase | Descripción | Estado | Completado |
|------|-------------|--------|-----------|
| 0 | Setup Inicial (monorepo, Bun, DB, Biome) | ✅ Completo | 100% |
| 1 | Base de datos + Query Builder | ✅ Completo | 100% |
| 2 | Autenticación y Seguridad | ✅ Completo | 100% |
| 3a | API — Catálogos (Cargos, Funciones, Departamentos) | ✅ Completo | 100% |
| 3b | API — Conceptos + Préstamos | ✅ Completo | 100% |
| 3c | API — Motor de Planillas | ✅ Completo | 100% |
| 3d | API — XIII Mes Panameño | 🔲 Pendiente | 0% |
| 3e | API — Asistencia (CRUD + UI completo) | 🔄 Parcial | 70% |
| 3f | API — Vacaciones | 🔲 Pendiente | 0% |
| 3g | API — Acreedores (+ auto-concepto) | ✅ Completo | 100% |
| 4 | Frontend — Empleados, Catálogos, Planillas, Préstamos, Asistencia, Acreedores | 🔄 En progreso | 92% |
| 4b | **Módulo de Reportes de Planilla (Planilla PDF ✅, resto pendiente)** | 🔄 En progreso | 20% |
| 5 | Módulos Avanzados (Excel, PDF, Importación) | 🔄 En progreso | 15% |
| 6 | Testing, Docker, Deploy | 🔲 Pendiente | 0% |

---

## Detalle por Fase

### ✅ Fase 0 — Setup Inicial

- Monorepo Turborepo con Bun workspaces (`apps/`, `packages/`)
- `apps/api` — Elysia 1.4 corriendo en puerto 3000
- `apps/web` — Astro 6 en modo SSR, puerto 4321
- `packages/db` — Drizzle ORM + cliente multi-tenant
- Biome (linter + formatter) + Husky pre-commit hook
- Variables de entorno tipadas con Zod (`src/config/env.ts`)

---

### ✅ Fase 1 — Base de Datos + Query Builder

**Schemas Drizzle creados** (`packages/db/src/schema/`):

| Archivo | Tablas |
|---------|--------|
| `tenant.ts` | `tenants`, `super_admins` |
| `users.ts` | `users` (tenant-level) |
| `employee.ts` | `employees` |
| `payroll.ts` | `payrolls`, `payroll_lines`, `payroll_acumulados`, `concepts`, `loans`, `loan_installments` |
| `creditors.ts` | `creditors` |
| `vacation.ts` | `vacation_balances`, `vacation_requests` |
| `attendance.ts` | `attendance_records`, `shifts` |
| `catalog.ts` | `cargos`, `funciones`, `departamentos` |

**Tabla `loans` — columnas actuales:**
```
id, employeeId, amount, balance, installment,
startDate, endDate, isActive,
loanType, frequency, creditorId, allowDecember,
createdAt
```

**Tabla `shifts` — columnas actuales:**
```
id, name,
entryTime, lunchStartTime, lunchEndTime, exitTime,
entryToleranceBefore, entryToleranceAfter,
lunchStartToleranceBefore, lunchStartToleranceAfter,
lunchEndToleranceBefore, lunchEndToleranceAfter,
exitToleranceBefore, exitToleranceAfter,
isDefault, createdAt, updatedAt
```

**Multitenancy:**
- Schema público: `tenants`, `super_admins`
- Schema por tenant: `tenant_{slug}` (resto de tablas)
- Sin `.references()` en FK del schema tenant (evita bug drizzle-kit con `"public"."table"`)

**TenantMigrationSystem** (`packages/db/src/migrate.ts`):
- `--public` — migra schema público
- `--tenant=slug` — migra un tenant específico
- `--all-tenants` — migra todos los tenants activos con manejo de errores individuales

**Migraciones aplicadas (`drizzle/tenant/`):**

| Tag | Contenido |
|-----|-----------|
| `0000_sour_black_crow` | Tablas base (users, employees, concepts, loans, payrolls...) |
| `0001_fuzzy_slyde` | Catálogos (cargos, funciones, departamentos) |
| `0002_broad_invaders` | FK columns en employees (cargoId, funcionId, departamentoId) |
| `0003_payroll_acumulados` | Tabla payroll_acumulados |
| `0004_normalise_payroll_status` | Status estándar en payrolls |
| `0005_ensure_payroll_acumulados` | Ensure migration |
| `0006_concept_config` | Config avanzada de conceptos |
| `0007_loans_extra_fields` | loanType, frequency, creditor (texto), allowDecember en loans |
| `0007_creditors_loan_installments` | Tabla loan_installments |
| `0008_company_config` | Configuración por empresa |
| `0009_creditors` | Tabla creditors + creditorId FK en loans |
| `0010_add_description_to_creditors` | Campo description en creditors |
| `0011_attendance_shifts_redesign` | Rediseño de shifts: entryTime/exitTime/lunchStartTime/lunchEndTime + 8 columnas de tolerancias |

**Custom Query Builder** (`packages/db/src/query-builder.ts`):
- Empleados: `listEmployees`, `getEmployee`, `createEmployee`, `updateEmployee`, `deactivateEmployee`
- Planillas: `listPayrolls`, `getPayroll`, `getPayrollLines`, `getPayrollLineById`, `createPayroll`, `updatePayroll`, `upsertPayrollLine`, `deletePayrollLines`, `deleteCreatedPayroll`, `loadAccumulated`, `loadAccumulatedByDateRange`, `insertPayrollAcumulados`, `deletePayrollAcumulados`
- Préstamos: `listLoansByEmployee`, `listAllLoans`, `getLoanById`, `createLoan`, `updateLoan`, `closeLoan`, `getLoanInstallments`, `revertPayrollInstallments`, `bulkLoadCreditorInstallments`, `bulkGetPendingInstallments`, `bulkMarkInstallmentsPaid`, `bulkDeactivateCompletedLoans`, `bulkReactivateLoansWithPending`
- Acreedores: `listCreditors`, `getCreditor`, `createCreditor`, `updateCreditor`, `deleteCreditor`
- Catálogos: `listCargos`, `getCargoById`, `createCargo`, `updateCargo`, `deactivateCargo` (+ funciones y departamentos)
- Conceptos: `listConcepts`, `getConceptById`, `createConcept`, `updateConcept`, `deactivateConcept`
- Asistencia: `listAttendanceRecords`, `getAttendanceRecord`, `upsertAttendanceRecord`, `updateAttendanceById`, `deleteAttendanceRecord`
- Horarios: `listShifts`, `getShift`, `createShift`, `updateShift`, `deleteShift`
- Árbol: `getActiveChildCount`, `buildDepartamentoTree`, `getDescendantIds`

---

### ✅ Fase 2 — Autenticación y Seguridad

- `POST /auth/login` — valida credenciales, emite JWT en cookie httpOnly `auth`
- `POST /auth/logout` — limpia cookie
- `GET /auth/me` — retorna usuario autenticado
- JWT payload: `{ userId, tenantId, role }`
- Roles: `SUPER_ADMIN`, `ADMIN`, `HR`, `VIEWER`
- Middleware `guardAuth` + `guardRole(minRole)` aplicado a todas las rutas protegidas
- CSRF plugin activo en endpoints mutantes
- Rate limiting global (100 req/min) + estricto en `/auth/login` (10 req/min)
- Página `/login` en Astro con form POST y manejo de errores

---

### ✅ Fase 3a — API Catálogos

| Recurso | Rutas | Auth mínima |
|---------|-------|-------------|
| Cargos | `GET/POST /cargos`, `GET/PUT/DELETE /cargos/:id` | VIEWER / HR / ADMIN |
| Funciones | `GET/POST /funciones`, `GET/PUT/DELETE /funciones/:id` | VIEWER / HR / ADMIN |
| Departamentos | `GET/POST /departamentos`, `GET/PUT/DELETE /departamentos/:id`, `GET /departamentos/tree` | VIEWER / HR / ADMIN |

**Lógica especial:**
- Departamentos: estructura padre-hijo con prevención de ciclos (`getDescendantIds`)
- Baja de departamento bloqueada si tiene hijos activos
- Campos de empleado enriquecidos: `cargoId`, `funcionId`, `departamentoId` + desnormalización a `position`, `department`

**Frontend (Astro SSR):**
- `/config/cargos` — lista, nuevo, editar
- `/config/funciones` — lista, nuevo, editar
- `/config/departamentos` — lista con árbol JS, nuevo, editar (dropdown de padre con protección de ciclos)

---

### ✅ Fase 3b — API Conceptos + Préstamos

| Recurso | Rutas | Auth mínima |
|---------|-------|-------------|
| Conceptos | `GET/POST /concepts`, `GET/PUT/DELETE /concepts/:id` | VIEWER / HR / ADMIN |
| Préstamos | `GET /loans` (todos o `?employeeId=`), `GET/POST /loans`, `PUT/DELETE /loans/:id` | VIEWER / HR |

**Campos del body `POST /loans`:**
```
employeeId, amount, balance, installment, startDate, endDate,
loanType?, frequency?, creditorId?, allowDecember?
```

**Frontend (Astro SSR):**
- `/config/conceptos` — lista con badges tipo (Ingreso/Deducción), toggle activo/inactivo
- `/config/conceptos/new` y `/config/conceptos/[id]` — formulario con editor de fórmula
- Tab "Préstamos" en `/employees/[id]` — tabla inline con acciones
- `/employees/[id]/loans/new` — formulario completo con calculadora de cuotas
- `/employees/[id]/loans/[loanId]` — editar saldo, cuota, fechas; cerrar préstamo
- `/loans` — listado global de préstamos (todos los empleados)
- `/loans/new` — formulario completo con selector de empleado + calculadora

---

### ✅ Fase 3c — Motor de Planillas

```
packages/core/payroll/
├── engine.ts     — processLine(): evalúa conceptos en orden (income → deduction)
└── utils.ts      — countBusinessDays(), countCalendarDays(), round2()

apps/api/src/modules/payroll/
├── service.ts    — runGeneration(), closePayrollService(), reopenPayrollService()
└── routes.ts     — /generate, /regenerate, /close, /revert, /reopen
```

- Tipos de planilla: `regular`, `thirteenth`, `special`
- Frecuencias: `biweekly`, `monthly`, `weekly`
- Máquina de estados: `created → generated → closed` (+ regenerate, revert, reopen)
- `payroll_acumulados` — registro por empleado+concepto para consultas históricas
- Variables de fórmula: SALARIO, SUELDO, FICHA, FECHAINICIO/FIN/PAGO, ANTIGUEDAD, etc.

**Correcciones de rendimiento (sesión 2):**

- **`CUOTA_ACREEDOR()` N×M queries** — reemplazado por `bulkLoadCreditorInstallments`: pre-carga todos los montos de cuota por empleado y acreedor en 1 query antes de la generación. Reducción: ~10,000 queries → ~8.
- **`closePayrollService` loop per-employee** — reemplazado por `bulkGetPendingInstallments` (3 queries) + `bulkMarkInstallmentsPaid` + `bulkDeactivateCompletedLoans`. Reducción: ~5,000 queries → ~8.
- **`reopenPayrollService` loop per-employee** — reemplazado por `bulkReactivateLoansWithPending`. Reducción: ~3,000 queries → ~5.
- **Status `processing` stuck** — `ALLOWED_FOR_REGENERATE` ampliado para incluir `'processing'`; al regenerar desde ese estado se trata como si fuera `'generated'`.

**Corrección `allowZero` (sesión 2):**

- `ConceptInput` extendido con `allowZero?: boolean`
- En `processLine()`: si `amount === 0 && concept.allowZero === false`, se omite la entrada del output pero se registra el valor en `resolvedConcepts` para que otras fórmulas puedan referenciarlo con `CONCEPTO()`
- Ambas llamadas a `activeConcepts.map()` en `service.ts` ahora pasan `allowZero: c.allowZero`

---

### 🔲 Fase 3d — XIII Mes Panameño (PENDIENTE)

- Tablas y períodos ya definidos en schema
- `getThirteenthMonthPeriods()` — semestres Ene–Jun (pago abril) y Jul–Dic (pago diciembre)
- Pendiente: endpoint dedicado con lógica automática + UI de vista previa y cierre

---

### 🔄 Fase 3e — Asistencia (PARCIALMENTE COMPLETO)

**Completado:**
- [x] Tablas: `attendance_records`, `shifts` definidas y migradas
- [x] Rediseño de `shifts`: 4 campos de hora (entry/lunchStart/lunchEnd/exit) + 8 columnas de tolerancias (-antes/+después por cada punto)
- [x] API CRUD completo:
  - `GET /attendance` — lista con filtros (fecha, empleado) + JOIN a employees
  - `POST /attendance` — crear/actualizar por (employeeId, date) — upsert
  - `GET /attendance/:id` — detalle con datos del empleado
  - `PUT /attendance/:id` — editar marcaciones individuales
  - `DELETE /attendance/:id` — eliminar registro
  - `GET /attendance/shifts` — listar horarios
  - `POST /attendance/shifts` — crear horario
  - `GET /attendance/shifts/:id` — detalle horario
  - `PUT /attendance/shifts/:id` — editar horario
  - `DELETE /attendance/shifts/:id` — eliminar horario
- [x] `upsertAttendanceRecord` — crea o actualiza por `(employeeId, date)`, calcula `workedMinutes` automáticamente
- [x] `updateAttendanceById` — preserva campos omitidos, recalcula `workedMinutes`
- [x] Frontend completo: lista, nuevo, editar, horarios lista, nuevo, editar

**Pendiente:**
- [ ] Procesamiento de marcaciones brutas (tolerancias → lateMinutes, overtimeMinutes)
- [ ] Webhook `POST /webhooks/attendance` para integración con dispositivos externos
- [ ] Cálculo de `lateMinutes` y `overtimeMinutes` al guardar

---

### 🔲 Fase 3f — Vacaciones (PENDIENTE)

- Tablas: `vacation_balances`, `vacation_requests` definidas
- `calcVacationDaysEarned()` implementada
- Pendiente: endpoints CRUD, integración planilla, UI `/vacations`

---

### ✅ Fase 3g — Módulo Acreedores (COMPLETO)

**Implementado:**
- Tabla `creditors` (id, code, description, conceptId, isActive)
- Al crear un acreedor → se crea automáticamente un **concepto de deducción** vinculado
- `DELETE /creditors/:id` — desactiva el acreedor y su concepto vinculado
- Campo `creditor` en `loans` migrado de texto libre a FK `creditorId → creditors.id`
- Endpoints: `GET/POST /creditors`, `GET/PUT/DELETE /creditors/:id`
- Frontend: `/config/acreedores` — lista, nuevo (con vista previa del concepto generado), editar

---

## 🔄 Fase 4 — Frontend Astro (En Progreso — 92%)

### Completado

- [x] **Sistema de diseño CSS custom properties** — variables semánticas (`--ink`, `--navy-hi`, `--rule`, `--fore`, `--ok`, `--err`, etc.) con soporte de tema claro/oscuro via `data-theme` en `<html>`. Toggle persistido en `localStorage`. Tipografías: Fraunces (display), Inter Tight (sans), JetBrains Mono (mono).
- [x] **Sidebar jerárquico** — reemplazado de lista plana a grupos padre-hijo con `<details>/<summary>`. Auto-abierto cuando algún hijo está activo. Grupos: Panel, Estructura, Préstamos, Asistencia, Nómina, Reportes, Vacaciones, Liquidaciones, Configuración.
- [x] **Módulo Posiciones** (`/config/estructura`) — CRUD completo: lista con badge activo/inactivo, nuevo, editar. Vincula cargo, función, departamento y salario.
- [x] Empleados: lista con búsqueda, nuevo, editar con tabs (Personal, Laboral, Préstamos)
- [x] Catálogos: Cargos, Funciones, Departamentos, Conceptos
- [x] Planillas: lista, nuevo, detalle con stepper + tabla por empleado + desglose de conceptos
- [x] Acciones de planilla con modal de confirmación (Generar, Regenerar, Revertir, Cerrar, Reabrir)
- [x] **Módulo de Préstamos standalone:**
  - Lista global `/loans` — búsqueda, paginación, filtro por estado
  - Formulario `/loans/new` con selector de empleado, tipo, acreedor, frecuencia
  - Calculadora de cuotas client-side: tabla de amortización completa
  - `/employees/[id]/loans/[loanId]` — editar + tabla de cuotas con estado paid/pending
- [x] **Módulo Acreedores:** `/config/acreedores` — lista, nuevo, editar
- [x] **Módulo Asistencia:**
  - `/attendance` — lista ordenada por fecha, filtros por fecha y empleado
  - `/attendance/new`, `/attendance/[id]` — crear/editar marcaciones
  - `/attendance/shifts` — lista, nuevo, editar horarios con tolerancias

### Nuevo endpoint (sesión 2)

- `GET /loans/:id/installments` — retorna tabla de cuotas de un préstamo; usado en la página de edición

### Pendiente

- [ ] **Dashboard** — métricas reales (empleados activos, última planilla, acumulados del mes)
- [x] **PDF planilla** — descarga del PDF consolidado en formato horizontal (ver Fase 4b)
- [ ] **Exportación Excel** — planilla a `.xlsx` (pendiente de refactor a la capa de reportes)

---

## 🔄 Fase 4b — Módulo de Reportes de Planilla (En Progreso — 20%)

**Objetivo:** centralizar la generación de reportes asociados a una planilla
en una capa extensible, de modo que agregar un nuevo formato (Excel, Anexo 09,
comprobantes, etc.) requiera el mínimo de cambios cruzados.

### Arquitectura

```
apps/web/src/lib/reports/
├── payroll-data.ts            — fetcher único (auth + tenant + errores)
├── payroll-pdf-renderer.ts    — envuelve renderToBuffer() + headers HTTP
└── registry.ts                — catálogo declarativo de reportes

apps/web/src/pages/
├── reports/payroll.astro      — listado + dropdown "Reportes"
└── api/reports/payroll/[id]/
    └── pdf.ts                 — GET: descarga el PDF landscape
```

**Flujo de un reporte:**

1. El usuario abre `/reports/payroll`.
2. La página carga planillas con estado `generated|closed` y renderiza, por
   fila, un dropdown construido a partir de `PAYROLL_REPORTS` (registry).
3. Cada entrada del registry declara `href(payrollId)`. Las entradas con
   `status: 'coming-soon'` se renderizan deshabilitadas + badge
   "Próximamente"; las `'available'` se renderizan como `<a>` que llama al
   endpoint de descarga.
4. El endpoint delega a `fetchPayrollReportData` + el renderer específico
   (p. ej. `renderPayrollPdfResponse`).

### Librerías

| Librería | Uso |
|----------|-----|
| `@react-pdf/renderer` | Generación del PDF (ya estaba instalado) |
| `react` + `react-dom` | Necesarios para `@react-pdf/renderer` |

No se introdujeron nuevas dependencias. La orientación horizontal se logra
mediante `orientation="landscape"` en el componente `PayrollPdf`
(`apps/web/src/lib/pdf/payroll-pdf.tsx`).

### Completado

- [x] **Planilla PDF (A4 landscape, sin tope de empleados)** — formato
  oficial con 10 columnas, fila de totales, 3 firmas, encabezado con logo
  + nombre + tipo + período, footer con fecha+hora y "Página X de Y".
- [x] Paginación completa en el fetcher: pages 2..N en paralelo.
- [x] Filtros propagados desde `/payroll/[id]`: `search`, `department`,
  `employeeIds`, `payrollTypeId` (con fallback a la cookie
  `payroll.activeTypeId`). Parser compartido `parsePayrollReportFilters`.
- [x] Cédula del empleado (`idNumber`) expuesta desde `getPayrollLines`.
- [x] Nuevo endpoint canónico `GET /api/reports/payroll/:id/pdf`.
- [x] Ruta legacy `GET /api/payroll/:id/pdf` mantenida (delega al renderer
  compartido).
- [x] Vista `/reports/payroll` con búsqueda, paginación y filtrado de
  estados.
- [x] Enlace "Más reportes" desde la vista de detalle hacia `/reports/payroll`.

### Pendiente

- [ ] **Planilla en Excel** (`xlsx`) — refactor del endpoint actual
  `/api/payroll/:id/xlsx` para consumir `fetchPayrollReportData` y montarlo
  bajo `/api/reports/payroll/:id/xlsx`.
- [ ] **Resumen de Planilla** (`summary`) — reporte PDF con totales
  agregados por departamento y tipo de concepto.
- [ ] **Comprobantes de pago** (`payslips`) — PDF por empleado
  (reutilizar `StubPdf` existente); generar un archivo por línea o un zip
  con todos los comprobantes de la planilla.
- [ ] **Enviar comprobantes por email** (`payslips-email`) — job asíncrono
  que genere y envíe cada comprobante; requiere proveedor SMTP/API.
- [ ] **Anexo 09** (`anexo-09`) — reporte exigido por la CSS.

---

## Archivos Clave

```
apps/api/src/
├── index.ts
├── config/env.ts
├── middleware/
│   ├── auth.ts, tenant.ts, csrf.ts, rateLimit.ts
└── modules/
    ├── auth/routes.ts
    ├── employees/routes.ts + service.ts
    ├── employees/loans/routes.ts + service.ts
    ├── payroll/routes.ts + service.ts
    ├── attendance/routes.ts + service.ts
    ├── creditors/routes.ts + service.ts
    ├── positions/routes.ts + service.ts        ← CRUD posiciones
    └── catalogs/
        ├── cargos/, funciones/, departamentos/
        └── concepts/routes.ts + service.ts

packages/db/src/
├── schema/
│   ├── tenant.ts, users.ts, employee.ts
│   ├── payroll.ts
│   ├── creditors.ts                            ← NUEVO
│   ├── vacation.ts, attendance.ts
│   ├── catalog.ts
│   └── index.ts
├── client.ts
├── query-builder.ts
└── migrate.ts

apps/web/src/
├── layouts/AppLayout.astro
├── pages/
│   ├── login.astro
│   ├── employees/ (index, new, [id])
│   ├── employees/[id]/loans/ (new, [loanId])
│   ├── loans/ (index, new)
│   ├── payroll/ (index, new, [id])
│   ├── attendance/ (index, new, [id])          ← NUEVO
│   ├── attendance/shifts/ (index, new, [id])   ← NUEVO
│   ├── config/
│   │   ├── cargos/, funciones/, departamentos/, conceptos/
│   │   ├── acreedores/ (index, new, [id])
│   │   └── estructura/ (index, new, [id])       ← posiciones CRUD
│   └── api/
│       ├── auth/
│       ├── employees/ ([id].ts, index.ts)
│       ├── employees/[id]/loans/ (index.ts, [loanId].ts)
│       ├── loans/index.ts
│       ├── attendance/ (index.ts, [id].ts)
│       ├── attendance/shifts/ (index.ts, [id].ts)
│       └── config/
│           ├── cargos/, funciones/, departamentos/, conceptos/
│           └── acreedores/ (index.ts, [id].ts)
```

---

## Notas Técnicas Importantes

1. **Sin FK constraints en schema tenant** — Drizzle Kit genera `"public"."table"` en los FK que rompe el `search_path` multi-tenant. Todos los `uuid()` de FK en tablas tenant omiten `.references()`.

2. **Desnormalización** — `employees.position` y `employees.department` se sincronizan automáticamente desde `cargos.name` y `departamentos.name` al crear/editar un empleado.

3. **HTML method override** — Para PUT/DELETE se usa `<input type="hidden" name="_method" value="PUT">` y el handler API lo interpreta.

4. **`buildOptions()`** — Helper en páginas de edición que incluye el ítem actualmente vinculado aunque esté inactivo, para no romper el select del formulario.

5. **Calculadora de cuotas** — Lógica client-side (`is:inline`) sin dependencias externas. Divide el monto total en céntimos para evitar errores de punto flotante. La última cuota absorbe el residuo (centavos) para que el total sea exacto.

6. **Modal de confirmación** — Patrón `data-confirm` en botones: `data-form`, `data-title`, `data-body`, `data-confirm-label`, `data-confirm-style`. Estilos disponibles: `danger` (rojo), `warning` (ámbar), `success` (esmeralda), `primary` (azul). Modal con backdrop-click y Escape-to-close. Aplicado en planillas, asistencia y horarios.

7. **Formularios anidados prohibidos** — HTML no permite `<form>` dentro de `<form>`. En páginas con formulario de edición + botón de eliminar, el form de delete se coloca fuera del form de edición (sección separada con borde).

8. **Orden de rutas Elysia** — Las rutas estáticas (e.g., `/shifts`) deben declararse ANTES de las rutas con parámetros (`/:id`) para evitar que Elysia interprete "shifts" como un ID.

9. **Timestamps de asistencia** — La DB almacena columnas `timestamp` en PostgreSQL. El API acepta strings `HH:MM` y construye objetos `Date`. El frontend usa `toLocaleTimeString('es-PA', { hour12: false, timeZone: 'America/Panama' })`. Las columnas `time` de `shifts` retornan `HH:MM:SS`; se recortan con `.slice(0, 5)`.

10. **`getPendingInstallmentsByEmployee`** — Requiere 3 argumentos: `(db, employeeId, periodEnd)`. El `periodEnd` filtra préstamos por `lte(loans.startDate, periodEnd)`. Pasar `undefined` genera SQL inválido → HTTP 500.

11. **Operaciones bulk en planillas** — Las funciones `bulkGetPendingInstallments`, `bulkMarkInstallmentsPaid`, `bulkDeactivateCompletedLoans` y `bulkReactivateLoansWithPending` reemplazan loops N+1 en cierre/reapertura de planilla. `bulkGetPendingInstallments` usa un patrón de 3 queries: préstamos activos → `min(installmentNumber)` por préstamo → fetch de pendientes + filtro JS, evitando `DISTINCT ON` (no soportado en Drizzle ORM de forma portable).

12. **Sidebar con `<details>/<summary>`** — Los grupos se auto-abren cuando algún hijo coincide con la ruta actual (`groupActive()`). El tipo `NavEntry` es una unión discriminada `{ kind: 'item' } | { kind: 'group' }`. Los íconos son inline SVG generados desde un `Record<IconKey, string>` para evitar dependencias de librerías de íconos.

13. **Sistema de diseño CSS custom properties** — Todas las variables de color son semánticas (`--ink`, `--fore`, `--navy`, `--ok`, `--err`, etc.) y se sobrescriben en `[data-theme="light"]`. El tema se persiste en `localStorage` y se lee con un `<script is:inline>` síncrono en `<head>` para evitar flash de tema incorrecto (FOIT).

14. **Capa de reportes de planilla** — Para agregar un nuevo reporte sólo se
    modifica `apps/web/src/lib/reports/registry.ts` (descriptor) y se añade el
    endpoint correspondiente en `apps/web/src/pages/api/reports/payroll/[id]/<nombre>.ts`,
    reutilizando `fetchPayrollReportData` para el I/O. El dropdown de
    `/reports/payroll` y el detalle de planilla se actualizan automáticamente
    a partir del registry — no hay duplicación de listas de reportes.
