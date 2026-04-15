# Estado del Proyecto — PayrollSoft

**Última actualización:** Abril 2026  
**Branch activo:** `claude/refactor-loans-astro-YT615`

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
| 4 | Frontend — Empleados, Catálogos, Planillas, Préstamos, Asistencia, Acreedores | 🔄 En progreso | 90% |
| 5 | Módulos Avanzados (Excel, PDF, Importación) | 🔲 Pendiente | 0% |
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
- Préstamos: `listLoansByEmployee`, `listAllLoans`, `getLoanById`, `createLoan`, `updateLoan`, `closeLoan`, `getPendingInstallmentsByEmployee`, `countPendingInstallments`, `loadInstallmentsByCreditor`, `markInstallmentPaid`, `revertPayrollInstallments`
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

## 🔄 Fase 4 — Frontend Astro (En Progreso — 90%)

### Completado

- [x] UI moderna (Tailwind CSS puro, sidebar, layout base)
- [x] Empleados: lista con búsqueda, nuevo, editar con tabs (Personal, Laboral, Préstamos)
- [x] Catálogos: Cargos, Funciones, Departamentos, Conceptos
- [x] Planillas: lista, nuevo, detalle con stepper + tabla por empleado + desglose de conceptos
- [x] Acciones de planilla con modal de confirmación (Generar, Regenerar, Revertir, Cerrar, Reabrir)
- [x] **Módulo de Préstamos standalone:**
  - Lista global `/loans` — todos los préstamos con nombre de empleado, tipo, acreedor, frecuencia, estado
  - Formulario `/loans/new` con selector de empleado, tipo, acreedor (selector del catálogo), frecuencia
  - Calculadora de cuotas client-side: genera tabla de amortización completa
  - Soporte de frecuencias: semanal / quincenal / mensual
  - Toggle "Descontar en diciembre" (mueve cuotas dic → ene si desactivado)
- [x] **Módulo Acreedores:** `/config/acreedores` — lista, nuevo, editar
- [x] **Módulo Asistencia:**
  - `/attendance` — lista ordenada por fecha, filtros por fecha y empleado
  - `/attendance/new` — formulario con selector de empleado + 4 campos de hora
  - `/attendance/[id]` — editar marcaciones individuales + eliminar
  - `/attendance/shifts` — lista de horarios con tolerancias por punto
  - `/attendance/shifts/new` — formulario 4 secciones (Entrada/Sal.Alm./Ent.Alm./Salida) con tolerancias
  - `/attendance/shifts/[id]` — editar horario

### Pendiente

- [ ] **Dashboard** — métricas reales (empleados activos, última planilla, acumulados del mes)
- [ ] **PDF planilla** — descarga de planilla generada
- [ ] **Exportación Excel** — planilla a `.xlsx`

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
    ├── attendance/routes.ts + service.ts       ← NUEVO
    ├── creditors/routes.ts + service.ts        ← NUEVO
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
│   │   └── acreedores/ (index, new, [id])      ← NUEVO
│   └── api/
│       ├── auth/
│       ├── employees/ ([id].ts, index.ts)
│       ├── employees/[id]/loans/ (index.ts, [loanId].ts)
│       ├── loans/index.ts
│       ├── attendance/ (index.ts, [id].ts)     ← NUEVO
│       ├── attendance/shifts/ (index.ts, [id].ts) ← NUEVO
│       └── config/
│           ├── cargos/, funciones/, departamentos/, conceptos/
│           └── acreedores/ (index.ts, [id].ts) ← NUEVO
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
