# Estado del Proyecto — Payroll Panamá v2

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
| 3e | API — Asistencia + Webhooks | 🔲 Pendiente | 0% |
| 3f | API — Vacaciones | 🔲 Pendiente | 0% |
| 3g | API — Acreedores (+ auto-concepto) | 🔲 Pendiente | 0% |
| 4 | Frontend — Empleados, Catálogos, Planillas, Préstamos | 🔄 En progreso | 75% |
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
| `payroll.ts` | `payrolls`, `payroll_lines`, `concepts`, `loans` |
| `vacation.ts` | `vacation_balances`, `vacation_requests` |
| `attendance.ts` | `attendance_records`, `shifts`, `tolerances` |
| `catalog.ts` | `cargos`, `funciones`, `departamentos` |

**Tabla `loans` — columnas actuales:**
```
id, employeeId, amount, balance, installment,
startDate, endDate, isActive,
loanType, frequency, creditor, allowDecember,   ← añadidas en migración 0007
createdAt
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
| `0007_loans_extra_fields` | loanType, frequency, creditor, allowDecember en loans |

**Custom Query Builder** (`packages/db/src/query-builder.ts`):
- Empleados: `listEmployees`, `getEmployee`, `createEmployee`, `updateEmployee`, `deactivateEmployee`
- Planillas: `listPayrolls`, `getPayrollLines`, `loadAccumulated`
- Catálogos: `listCargos`, `getCargoById`, `createCargo`, `updateCargo`, `deactivateCargo` (+ funciones y departamentos)
- Conceptos: `listConcepts`, `getConceptById`, `createConcept`, `updateConcept`, `deactivateConcept`
- Préstamos: `listLoansByEmployee`, `listAllLoans` (con JOIN a employees), `getLoanById`, `createLoan`, `updateLoan`, `closeLoan`
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

**Endpoints implementados:**

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
- Sidebar con sección "Configuración" desplegable

---

### ✅ Fase 3b — API Conceptos + Préstamos

**Endpoints implementados:**

| Recurso | Rutas | Auth mínima |
|---------|-------|-------------|
| Conceptos | `GET/POST /concepts`, `GET/PUT/DELETE /concepts/:id` | VIEWER / HR / ADMIN |
| Préstamos | `GET /loans` (todos o `?employeeId=`), `GET/POST /loans`, `PUT/DELETE /loans/:id` | VIEWER / HR |

**Campos del body `POST /loans`:**
```
employeeId, amount, balance, installment, startDate, endDate,
loanType?, frequency?, creditor?, allowDecember?
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
└── routes.ts     — /generate, /regenerate, /close, /reopen
```

- Tipos de planilla: `regular`, `thirteenth`, `special`
- Frecuencias: `biweekly`, `monthly`, `weekly`
- Máquina de estados con rollback en caso de error
- `payroll_acumulados` — registro por empleado+concepto para consultas históricas
- Variables de fórmula: SALARIO, SUELDO, FICHA, FECHAINICIO/FIN/PAGO, ANTIGUEDAD, etc.

---

### 🔲 Fase 3d — XIII Mes Panameño (PENDIENTE)

- Tablas y períodos ya definidos en schema
- `getThirteenthMonthPeriods()` — semestres Ene–Jun (pago abril) y Jul–Dic (pago diciembre)
- Pendiente: endpoint dedicado con lógica automática + UI de vista previa y cierre

---

### 🔲 Fase 3e — Asistencia + Webhooks (PENDIENTE)

- Tablas: `attendance_records`, `shifts`, `tolerances` definidas
- Pendiente: procesamiento de marcaciones, webhook `POST /webhooks/attendance`, UI `/attendance`

---

### 🔲 Fase 3f — Vacaciones (PENDIENTE)

- Tablas: `vacation_balances`, `vacation_requests` definidas
- `calcVacationDaysEarned()` implementada
- Pendiente: endpoints CRUD, integración planilla, UI `/vacations`

---

### 🔲 Fase 3g — Módulo Acreedores (PENDIENTE)

**Diseño previsto:**
- Catálogo `creditors` (id, code, description, isActive)
- Al crear un acreedor → se crea automáticamente un **concepto de deducción** vinculado
- La planilla usa ese concepto para descontar la cuota del préstamo correspondiente
- Endpoints: `GET/POST /creditors`, `GET/PUT/DELETE /creditors/:id`
- Frontend: `/config/acreedores` — lista, nuevo (con vista previa del concepto generado)
- En `/loans/new` y `/employees/[id]/loans/new`: el campo "Acreedor" pasará de texto libre a selector del catálogo

---

## 🔄 Fase 4 — Frontend Astro (En Progreso — 75%)

### Completado

- [x] UI moderna (Tailwind CSS puro, sidebar, layout base)
- [x] Empleados: lista con búsqueda, nuevo, editar con tabs (Personal, Laboral, Préstamos)
- [x] Catálogos: Cargos, Funciones, Departamentos, Conceptos
- [x] Planillas: lista, nuevo, detalle con stepper + tabla por empleado + desglose de conceptos
- [x] **Módulo de Préstamos standalone:**
  - Lista global `/loans` — todos los préstamos con nombre de empleado, tipo, acreedor, frecuencia, estado
  - Formulario `/loans/new` con selector de empleado, tipo, acreedor (texto), frecuencia
  - Calculadora de cuotas client-side: genera tabla de amortización completa
  - Soporte de frecuencias: semanal / quincenal / mensual
  - Toggle "Descontar en diciembre" (mueve cuotas dic → ene si desactivado)
  - Botón guardar bloqueado hasta generar tabla (previene submit incompleto)
  - Re-bloqueo automático si el usuario modifica los inputs después de generar
  - Formulario en contexto de empleado `/employees/[id]/loans/new` (sin selector)
- [x] "Préstamos" añadido al sidebar (entre Empleados y Planillas)

### Pendiente

- [ ] **Dashboard** — métricas reales (empleados activos, última planilla, acumulados del mes)
- [ ] **PDF planilla** — descarga de planilla generada
- [ ] **Exportación Excel** — planilla a `.xlsx`
- [ ] **Módulo Acreedores** — `/config/acreedores` (pendiente diseño de concepto auto-generado)
- [ ] **Asistencia, Vacaciones** — diferido a Fase 5

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
    └── catalogs/
        ├── cargos/, funciones/, departamentos/
        └── concepts/routes.ts + service.ts

packages/db/src/
├── schema/
│   ├── tenant.ts, users.ts, employee.ts
│   ├── payroll.ts          ← loans con: loanType, frequency, creditor, allowDecember
│   ├── vacation.ts, attendance.ts
│   ├── catalog.ts
│   └── index.ts
├── client.ts
├── query-builder.ts        ← listAllLoans() con JOIN a employees
└── migrate.ts

apps/web/src/
├── layouts/AppLayout.astro          ← sidebar: Dashboard, Empleados, Préstamos, Planillas...
├── pages/
│   ├── login.astro
│   ├── employees/ (index, new, [id])
│   ├── employees/[id]/loans/ (new, [loanId])
│   ├── loans/ (index, new)          ← NUEVO módulo standalone
│   ├── payroll/ (index, new, [id])
│   ├── config/
│   │   ├── cargos/, funciones/, departamentos/, conceptos/
│   └── api/
│       ├── auth/
│       ├── employees/ ([id].ts, index.ts)
│       ├── employees/[id]/loans/ (index.ts, [loanId].ts)
│       ├── loans/index.ts           ← NUEVO handler POST standalone
│       └── config/
│           ├── cargos/, funciones/, departamentos/, conceptos/
```

---

## Notas Técnicas Importantes

1. **Sin FK constraints en schema tenant** — Drizzle Kit genera `"public"."table"` en los FK que rompe el `search_path` multi-tenant. Todos los `uuid()` de FK en tablas tenant omiten `.references()`.

2. **Desnormalización** — `employees.position` y `employees.department` se sincronizan automáticamente desde `cargos.name` y `departamentos.name` al crear/editar un empleado.

3. **HTML method override** — Para PUT/DELETE se usa `<input type="hidden" name="_method" value="PUT">` y el handler API lo interpreta.

4. **`buildOptions()`** — Helper en páginas de edición que incluye el ítem actualmente vinculado aunque esté inactivo, para no romper el select del formulario.

5. **Calculadora de cuotas** — Lógica client-side (`is:inline`) sin dependencias externas. Divide el monto total en céntimos para evitar errores de punto flotante. La última cuota absorbe el residuo (centavos) para que el total sea exacto. Llena campos ocultos `installment` y `endDate` antes del submit; el botón Guardar permanece deshabilitado hasta generar la tabla y se re-bloquea si el usuario modifica los inputs.

6. **Acreedor como texto libre** — Temporalmente `creditor` es un `varchar(255)` libre en la tabla `loans`. Cuando se implemente el módulo de Acreedores (Fase 3g), se migrará a una FK con la tabla `creditors`.
