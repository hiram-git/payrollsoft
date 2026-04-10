# Estado del Proyecto — Payroll Panamá v2

**Última actualización:** Abril 2026  
**Branch activo:** `claude/review-and-plan-project-TmsZ4`

---

## Estado General

| Fase | Descripción | Estado | Completado |
|------|-------------|--------|-----------|
| 0 | Setup Inicial (monorepo, Bun, DB, Biome) | ✅ Completo | 100% |
| 1 | Base de datos + Query Builder | ✅ Completo | 100% |
| 2 | Autenticación y Seguridad | ✅ Completo | 100% |
| 3a | API — Catálogos (Cargos, Funciones, Departamentos) | ✅ Completo | 100% |
| 3b | API — Conceptos + Préstamos | ✅ Completo | 100% |
| 3c | API — Motor de Planillas | 🔲 Pendiente | 0% |
| 3d | API — XIII Mes Panameño | 🔲 Pendiente | 0% |
| 3e | API — Asistencia + Webhooks | 🔲 Pendiente | 0% |
| 3f | API — Vacaciones | 🔲 Pendiente | 0% |
| 4 | Frontend completo (Planillas, Asistencia, Vacaciones) | 🔲 Pendiente | 0% |
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

**Multitenancy:**
- Schema público: `tenants`, `super_admins`
- Schema por tenant: `tenant_{slug}` (resto de tablas)
- Sin `.references()` en FK del schema tenant (evita bug drizzle-kit con `"public"."table"`)

**TenantMigrationSystem** (`packages/db/src/migrate.ts`):
- `--public` — migra schema público
- `--tenant=slug` — migra un tenant específico
- `--all-tenants` — migra todos los tenants activos con manejo de errores individuales

**Custom Query Builder** (`packages/db/src/query-builder.ts`):
- Empleados: `listEmployees`, `getEmployee`, `createEmployee`, `updateEmployee`, `deactivateEmployee`
- Planillas: `listPayrolls`, `getPayrollLines`, `loadAccumulated`
- Catálogos: `listCargos`, `getCargoById`, `createCargo`, `updateCargo`, `deactivateCargo` (+ funciones y departamentos)
- Conceptos: `listConcepts`, `getConceptById`, `createConcept`, `updateConcept`, `deactivateConcept`
- Préstamos: `listLoansByEmployee`, `getLoanById`, `createLoan`, `updateLoan`, `closeLoan`
- Departamentos con árbol: `getActiveChildCount`; helpers de árbol en `catalog.ts`: `buildDepartamentoTree`, `getDescendantIds`

**Migraciones generadas:**
- `drizzle/public/` — schema público (tenants, super_admins)
- `drizzle/tenant/0000_*` — tablas base tenant
- `drizzle/tenant/0001_*` — cargos, funciones, departamentos
- `drizzle/tenant/0002_*` — cargoId, funcionId, departamentoId en employees

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
- Campos de empleado enriquecidos: `cargoId`, `funcionId`, `departamentoId` + desnormalización a `position`, `department` en `updateEmployee`/`createEmployee`

**Frontend (Astro SSR):**
- `/config/cargos` — lista, nuevo, editar
- `/config/funciones` — lista, nuevo, editar
- `/config/departamentos` — lista con árbol JS, nuevo, editar (dropdown de padre con protección de ciclos)
- Sidebar con sección "Configuración" desplegable
- Formulario de empleado con dropdowns de Cargo, Función, Departamento (incluye inactivo actual via `buildOptions`)

---

### ✅ Fase 3b — API Conceptos + Préstamos

**Endpoints implementados:**

| Recurso | Rutas | Auth mínima |
|---------|-------|-------------|
| Conceptos | `GET/POST /concepts`, `GET/PUT/DELETE /concepts/:id` | VIEWER / HR / ADMIN |
| Préstamos | `GET /loans?employeeId=`, `GET/POST /loans`, `PUT/DELETE /loans/:id` | VIEWER / HR |

**Frontend (Astro SSR):**
- `/config/conceptos` — lista con badges de tipo (Ingreso/Deducción)
- `/config/conceptos/new` — formulario con campo fórmula (textarea monoespaciado)
- `/config/conceptos/[id]` — editar/dar de baja
- Tab "Préstamos" en `/employees/[id]` con tabla inline
- `/employees/[id]/loans/new` — registrar préstamo (balance inicial = monto)
- `/employees/[id]/loans/[loanId]` — editar saldo, cuota, fechas; cerrar préstamo

---

### 🔲 Fase 3c — Motor de Planillas (PENDIENTE)

Próximo a implementar:
- `PayrollEngine` en `packages/core/payroll/`
- CRUD de planillas: crear, procesar, cerrar
- Procesamiento por línea (empleado × conceptos)
- Evaluación de fórmulas con contexto de empleado
- Integración con préstamos activos (descuento automático de cuota)
- Acumulados por período

---

### 🔲 Fase 3d — XIII Mes Panameño (PENDIENTE)

- Cálculo semestral acumulado (Ene–Jun, Jul–Dic)
- Regla: 1/12 del salario por mes trabajado en el período
- Integración con conceptos de planilla regular
- Endpoint dedicado + UI de vista previa y cierre

---

### 🔲 Fase 3e — Asistencia + Webhooks (PENDIENTE)

- `POST /webhooks/attendance` — ingesta de marcaciones Base44
- Procesador: calcular `workedMinutes`, `lateMinutes`, `overtimeMinutes`
- Turnos (`shifts`) y tolerancias (`tolerances`) configurables
- Frontend: `/attendance` con calendario de marcaciones

---

### 🔲 Fase 3f — Vacaciones (PENDIENTE)

- Regla Panamá: 1 día por cada 11 trabajados (hasta 30 días/año)
- Acumulado automático en cierre de planilla
- CRUD de solicitudes de vacaciones con flujo de aprobación
- Frontend: `/vacations` con historial y balance

---

## Archivos Clave

```
apps/api/src/
├── index.ts                          # Registro de todas las rutas
├── config/env.ts                     # Variables de entorno (Zod)
├── middleware/
│   ├── auth.ts                       # JWT, guardAuth, guardRole
│   ├── tenant.ts                     # Resolución X-Tenant → DB
│   ├── csrf.ts
│   └── rateLimit.ts
└── modules/
    ├── auth/routes.ts
    ├── employees/routes.ts + service.ts
    ├── catalogs/
    │   ├── cargos/routes.ts + service.ts
    │   ├── funciones/routes.ts + service.ts
    │   ├── departamentos/routes.ts + service.ts
    │   └── concepts/routes.ts + service.ts
    └── employees/loans/routes.ts + service.ts

packages/db/src/
├── schema/
│   ├── tenant.ts, users.ts, employee.ts
│   ├── payroll.ts, vacation.ts, attendance.ts
│   ├── catalog.ts (+ buildDepartamentoTree, getDescendantIds)
│   └── index.ts
├── client.ts                         # createTenantDb, createPublicDb
├── query-builder.ts                  # Todas las queries
└── migrate.ts                        # --public | --tenant | --all-tenants

apps/web/src/
├── layouts/AppLayout.astro           # Sidebar con Configuración desplegable
├── pages/
│   ├── login.astro
│   ├── employees/ (index, new, [id])
│   ├── employees/[id]/loans/ (new, [loanId])
│   ├── config/
│   │   ├── cargos/ (index, new, [id])
│   │   ├── funciones/ (index, new, [id])
│   │   ├── departamentos/ (index, new, [id])
│   │   └── conceptos/ (index, new, [id])
│   └── api/
│       ├── auth/
│       ├── employees/ ([id].ts, index.ts)
│       ├── employees/[id]/loans/ (index.ts, [loanId].ts)
│       └── config/
│           ├── cargos/, funciones/, departamentos/, conceptos/
```

---

## Notas Técnicas Importantes

1. **Sin FK constraints en schema tenant** — Drizzle Kit genera `"public"."table"` en los FK que rompe el `search_path` multi-tenant. Todos los `uuid()` de FK en tablas tenant omiten `.references()`.

2. **Desnormalización** — `employees.position` y `employees.department` se sincronizan automáticamente desde `cargos.name` y `departamentos.name` al crear/editar un empleado. Permite mostrar listas sin JOINs.

3. **HTML method override** — Los formularios HTML solo soportan GET/POST. Para PUT/DELETE se usa `<input type="hidden" name="_method" value="PUT">` y el handler API lo interpreta.

4. **`buildOptions()`** — Helper en páginas de edición que incluye el ítem actualmente vinculado aunque esté inactivo, para no romper el select del formulario.
