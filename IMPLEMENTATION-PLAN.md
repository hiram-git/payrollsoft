# Plan de Implementación - Payroll Panamá v2

**Fecha de inicio:** Abril 2026  
**Stack:** Bun • Elysia.js • Astro • Drizzle ORM • PostgreSQL  
**Duración estimada total:** ~42–65 días

---

## Resumen Ejecutivo

Este documento detalla el plan de implementación por fases del nuevo sistema de nómina. El objetivo es reconstruir el sistema actual con tecnologías modernas, manteniendo toda la lógica de negocio (fórmulas, XIII mes, vacaciones, acumulados) y agregando multitenancy, seguridad robusta y una UI renovada.

---

## Arquitectura de Referencia

```
payroll-panama/
├── apps/
│   ├── api/          # Elysia + Bun (backend)
│   └── web/          # Astro + React islands (frontend)
├── packages/
│   ├── core/         # Motor de fórmulas, nómina, asistencia
│   ├── db/           # Drizzle schemas + client multi-tenant
│   ├── types/        # Tipos compartidos Zod + TS
│   └── utils/        # Helpers PDF, fechas Panamá
├── biome.json
├── turbo.json
└── package.json      # Root workspace
```

---

## Fase 0 — Setup Inicial
**Duración:** 1–2 días  
**Prioridad:** CRÍTICA — todo lo demás depende de esto  
**Estado: ✅ COMPLETO**

### Objetivos
- [x] Monorepo funcional con Bun workspaces
- [x] API y Web corriendo en paralelo con `bun run dev`
- [x] Base de datos conectada
- [x] Linting y hooks configurados

### Tareas

#### 0.1 Inicializar monorepo
```bash
mkdir payroll-panama && cd payroll-panama
bun init
# Configurar workspaces en package.json raíz
```
- Crear `package.json` raíz con `workspaces: ["apps/*", "packages/*"]`
- Configurar `turbo.json` para pipelines `build`, `dev`, `lint`

#### 0.2 Crear `apps/api` (Elysia)
```bash
cd apps/api && bun add elysia @elysiajs/cors @elysiajs/jwt @elysiajs/cookie
```
- `src/index.ts` — instancia principal de Elysia
- `src/config/env.ts` — variables de entorno tipadas con Zod
- `src/config/db.ts` — conexión dinámica al tenant

#### 0.3 Crear `apps/web` (Astro)
```bash
cd apps/web && bun create astro
bun add @astrojs/react tailwindcss
```
- Modo `hybrid` (SSR + static)
- Layout base + página de login placeholder

#### 0.4 Configurar `packages/db`
- Instalar Drizzle ORM: `bun add drizzle-orm postgres`
- `client.ts` — conexión dinámica multi-tenant
- `drizzle.config.ts` — apuntar a schema central

#### 0.5 Multitenancy básico + Super Admin
- Tabla `tenants` en schema público de PostgreSQL
- Tabla `super_admins` con acceso transversal
- Middleware `tenantResolver` que lee subdomain o header `X-Tenant`

#### 0.6 Calidad de código
- `biome.json` — linter + formatter (reemplaza ESLint/Prettier)
- `.husky/pre-commit` — correr `biome check` antes de cada commit
- `.env.example` y `.env.pgsql.example`

**Milestone:** `bun run dev` levanta API en `:3000` y Web en `:4321` simultáneamente.

---

## Fase 1 — Base de Datos + Core Engine
**Duración:** 5–7 días  
**Depende de:** Fase 0  
**Estado: ✅ COMPLETO**

### Objetivos
- [x] Todos los schemas de Drizzle creados y migrados (28 tablas en 10 archivos)
- [x] Motor de Fórmulas V3.5.3 portado y funcionando — lexer, parser, evaluator, engine, 6 funciones
- [x] Custom Query Builder v2 implementado
- [x] Sistema de migración custom con salida verbose (`--public`, `--tenant`, `--all-tenants`)

### Tareas

#### 1.1 Schemas Drizzle (`packages/db/schema/`)

| Archivo | Tablas principales |
|---------|-------------------|
| `tenant.ts` | `tenants`, `tenant_config` |
| `employee.ts` | `employees`, `employee_fields`, `employee_documents` |
| `payroll.ts` | `payrolls`, `payroll_lines`, `concepts`, `loans` |
| `vacation.ts` | `vacation_balances`, `vacation_requests` |
| `attendance.ts` | `attendance_records`, `shifts`, `tolerances` |
| `formulas.ts` | `formula_definitions`, `formula_history` |

- Usar `pgSchema` de Drizzle para schemas por tenant
- Convención: schema `tenant_{slug}` por empresa

#### 1.2 Motor de Fórmulas V3.5.3 (`packages/core/formulas/`)

Portar el motor existente garantizando:
- Soporte para funciones: `INIPERIODO`, `ACUMULADOS`, `CONCEPTO`, `SALDO`, `DIAS`
- Parser de expresiones con soporte a variables dinámicas
- Contexto de ejecución: `{ employee, period, concepts, attendance }`
- Manejo de errores con mensajes descriptivos
- Tests unitarios para cada función nativa

Estructura:
```
packages/core/formulas/
├── engine.ts         # FormulaEngine class
├── parser.ts         # Tokenizer + AST
├── functions/        # INIPERIODO.ts, ACUMULADOS.ts, etc.
├── context.ts        # FormulaContext type
└── __tests__/
```

#### 1.3 Custom Query Builder v2 (`packages/db/`)
- Wrapper sobre Drizzle para queries comunes de nómina
- Soporte a filtros dinámicos (campos personalizados de empleados)
- Paginación tipada + sorting

#### 1.4 TenantMigrationSystem
- Script `packages/db/migrate-tenant.ts`
- Crea el schema `tenant_{slug}` y corre migraciones
- Comando: `bun run db:migrate --tenant=acme`

**Milestone:** Todas las tablas creadas + motor de fórmulas pasa todos los tests.

---

## Fase 2 — Autenticación y Seguridad
**Duración:** 3–4 días  
**Depende de:** Fase 0, Fase 1 (parcial)  
**Estado: ✅ COMPLETO**

### Objetivos
- [x] Login multi-tenant funcional
- [x] JWT + cookies httpOnly
- [x] Sistema de roles y permisos (SUPER_ADMIN, ADMIN, HR, VIEWER)
- [x] CSRF y rate limiting activos

### Tareas

#### 2.1 Auth con Elysia JWT
```typescript
// apps/api/src/middleware/auth.ts
import { jwt } from '@elysiajs/jwt'
import { cookie } from '@elysiajs/cookie'
```
- Endpoints: `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`
- JWT payload: `{ userId, tenantId, role, permissions }`
- Refresh token con rotación

#### 2.2 Roles y Permisos ✅
- [x] Roles: `SUPER_ADMIN`, `ADMIN`, `HR`, `ACCOUNTANT`, `VIEWER` (jerarquía numérica)
- [x] `guardRole(minRole)` middleware por ruta
- [ ] Tabla `roles` / `role_permissions` en DB — se implementó como jerarquía fija en código (no configurable por UI)
- [ ] Refresh tokens — JWT expira en 7 días fijos, sin endpoint de renovación

#### 2.3 CSRF + Rate Limiting ✅
- [x] CSRF: validación de `Origin` header en requests mutantes
- [x] Rate limiting por IP: 100 req/min general (sliding window in-memory)
- [x] Rate limiting login: 10 req/min en `/auth/login`

**Milestone:** ✅ Login multi-tenant funcional con tokens, roles asignados.

---

## Fase 3 — API Core + Business Logic
**Duración:** 10–14 días  
**Depende de:** Fases 0, 1, 2  
**Estado: ✅ COMPLETO (3a ✅ 3b ✅ 3c ✅ — 3d/3e/3f parciales: tablas y lógica base sí, API+UI no)**

Esta es la fase más crítica. Contiene toda la lógica de negocio.

### Objetivos
- [x] CRUD completo de empleados con catálogos enlazados
- [x] Catálogos: Cargos, Funciones, Departamentos (árbol padre-hijo)
- [x] Conceptos de nómina (income/deduction + fórmula + toggle activo/inactivo)
- [x] Préstamos por empleado
- [x] Motor de nómina generando planillas correctas (`processLine()`)
- [x] Máquina de estados: `created → generated → closed` (+ regenerate, reopen)
- [x] Tabla `payroll_acumulados` — historial desnormalizado por empleado+concepto
- [ ] XIII Mes — endpoint y UI dedicados (tablas y períodos existen, falta API+UI)
- [ ] Asistencia — webhook y procesamiento de marcaciones (tablas sí, lógica no)
- [ ] Vacaciones — API y UI (tablas y cálculo sí, endpoints no)

### Tareas

#### 3.1 Módulo Empleados ✅
- [x] CRUD básico + búsqueda y filtros
- [x] Catálogos enlazados: cargoId, funcionId, departamentoId
- [x] Desnormalización de position/department en guardar
- [x] Préstamos (loans) — `modules/employees/loans/`

#### 3a Catálogos ✅
- [x] Cargos: CRUD completo con código único
- [x] Funciones: CRUD completo con código único
- [x] Departamentos: árbol padre-hijo, `GET /departamentos/tree`, prevención de ciclos, bloqueo de baja si hay hijos

#### 3b Conceptos + Préstamos ✅
- [x] `GET/POST/PUT/DELETE /concepts` — tipo income|deduction + fórmula
- [x] `POST /concepts/:id/activate` + `DELETE /concepts/:id` — toggle activo/inactivo
- [x] `GET /loans` (sin employeeId = lista global) + `GET /loans?employeeId` + `POST/PUT/DELETE /loans/:id`
- [x] Cierre de préstamo (soft-delete `isActive=false`)
- [x] Campos extendidos en `loans`: `loanType`, `frequency`, `creditor` (texto), `allowDecember`
- [x] `listAllLoans()` — query con JOIN a `employees` para mostrar nombre en lista global

#### 3c Motor de Planillas ✅
```
packages/core/payroll/
├── engine.ts     — processLine(): evalúa conceptos en orden (income → deduction)
└── utils.ts      — countBusinessDays(), countCalendarDays(), round2()

apps/api/src/modules/payroll/
├── service.ts    — runGeneration(), closePayrollService(), reopenPayrollService()
└── routes.ts     — /generate, /regenerate, /close, /reopen, legacy /process
```

- [x] Tipos de planilla: `regular`, `thirteenth`, `special`
- [x] Frecuencias: `biweekly`, `monthly`, `weekly`
- [x] Máquina de estados con rollback en caso de error
- [x] `payroll_acumulados` — registro por empleado+concepto para consultas históricas
- [x] Variables de fórmula: SALARIO, SUELDO, FICHA, FECHAINICIO/FIN/PAGO, ANTIGUEDAD, GASTOS_REP, etc.

#### 3d XIII Mes Panameño ⏸ DIFERIDO — depende de Fase 5
- [x] Tipo `thirteenth` en catálogo de planillas
- [x] `getThirteenthMonthPeriods()` — semestres Ene–Jun (pago abril) y Jul–Dic (pago diciembre)
- [x] `payroll_acumulados` permite calcular el XIII acumulando `ACUMULADOS("SUELDO", 6)`
- [ ] Endpoint dedicado con lógica automática de cálculo ← Fase 5
- [ ] UI de vista previa y cierre semestral ← Fase 5

#### 3e Sistema de Asistencia ⏸ DIFERIDO — depende de Fase 5
- [x] Tablas: `attendance_records`, `shifts`, `tolerances`
- [x] Campos: `workedMinutes`, `lateMinutes`, `overtimeMinutes`, `lunchStart/End`
- [x] Tolerancias configurables (`entryToleranceMinutes`, `exitToleranceMinutes`, `strict|flexible`)
- [x] `getAttendanceSummaryForPeriod()` — usado en generación de planilla
- [ ] Procesamiento de marcaciones brutas (entrada/salida → minutos trabajados) ← Fase 5
- [ ] Webhook `POST /webhooks/attendance` para integración Base44 ← Fase 5
- [ ] Cálculo de descuento almuerzo ← Fase 5

#### 3f Vacaciones Panamá ⏸ DIFERIDO — depende de Fase 5
- [x] Tablas: `vacation_balances`, `vacation_requests`
- [x] `calcVacationDaysEarned()` — Regla Panamá: 1 día por 11 días trabajados (máx 30/año)
- [x] Función `SALDO()` en motor de fórmulas para consultar balance
- [ ] Endpoints CRUD de solicitudes de vacaciones ← Fase 5
- [ ] Integración con planilla (pago de vacaciones) ← Fase 5
- [ ] UI de solicitud y aprobación ← Fase 5

#### 3g Módulo Acreedores ⏸ PENDIENTE

Catálogo de acreedores (bancos, cooperativas, juzgados) con **creación automática de concepto** al registrar un acreedor.

**Diseño:**
- Nueva tabla `creditors` (id, code, description, conceptId, isActive)
- Al `POST /creditors` → se crea automáticamente un concepto de deducción vinculado (tipo `deduction`, fórmula usa `SALDO()` del préstamo)
- `DELETE /creditors/:id` — desactiva el concepto vinculado también
- En `/loans`: el campo `creditor` (actualmente texto libre) migrará a FK `creditorId → creditors.id`
- Migración requerida: `ALTER TABLE loans ADD creditor_id uuid; ALTER TABLE loans DROP COLUMN creditor;`

**Endpoints:**
```
GET    /creditors          — lista (VIEWER+)
POST   /creditors          — crear + auto-crear concepto (HR+)
GET    /creditors/:id
PUT    /creditors/:id      — editar (HR+)
DELETE /creditors/:id      — desactivar + desactivar concepto (ADMIN+)
```

**Frontend:**
- `/config/acreedores` — lista, nuevo (con vista previa del concepto que se generará), editar

#### 3h Liquidaciones ⏸ DIFERIDO — depende de Fase 5
- [ ] Cálculo de liquidación al desvincularse (prima de antigüedad, vacaciones pendientes, etc.)
- [ ] Endpoint + UI de liquidación ← Fase 5

**Milestone:** ✅ Generar planilla completa con conceptos por fórmula para empleados activos.

---

## Fase 4 — Frontend Astro
**Duración:** 8–12 días  
**Depende de:** Fases 0, 2, 3  
**Estado: 🔄 EN PROGRESO**

### Completado
- [x] UI moderna y responsiva (Tailwind CSS puro, sidebar, layout base)
- [x] Empleados: lista con búsqueda, nuevo, editar con tabs (Personal, Laboral, Préstamos)
- [x] Catálogos: Cargos, Funciones, Departamentos, Conceptos (toggle activo/inactivo)
- [x] Planillas: lista estilo Vercel, detalle con stepper, acciones contextuales por estado
- [x] Detalle planilla: tabla por empleado, desglose de conceptos colapsable, totales bruto/deducciones/neto
- [x] **Módulo Préstamos standalone** (`/loans`):
  - Lista global con empleado, tipo, acreedor, monto, saldo, cuota, frecuencia, estado
  - Formulario `/loans/new` con selector de empleado + acreedor + tipo + frecuencia
  - Calculadora de cuotas client-side — tabla de amortización completa (fecha, cuota, saldo inicial, amortización, saldo final)
  - Frecuencias: semanal / quincenal / mensual (preserva día del mes en mensual)
  - Toggle "Descontar en diciembre" (cuotas de dic pasan a ene si desactivado)
  - Botón Guardar deshabilitado hasta generar tabla; se re-bloquea si el usuario modifica inputs
  - Tab "Préstamos" en `/employees/[id]` usa el mismo formulario en contexto de empleado
  - "Préstamos" en sidebar (entre Empleados y Planillas)

### Pendiente (prioridad Fase 4)
- [ ] **Dashboard** — métricas reales (empleados activos, última planilla, acumulados del mes)
- [ ] **PDF planilla** — descarga de planilla generada (recibo individual + reporte general)
- [ ] **Exportación Excel** — planilla generada a `.xlsx`
- [ ] **Módulo Acreedores** — `/config/acreedores` (espera diseño de concepto auto-generado, ver Fase 3g)

### Diferido a Fase 5
- [ ] DataTables con TanStack Table (filtros, sort, paginación cliente)
- [ ] Calendario de asistencia (FullCalendar)
- [ ] Módulo de vacaciones (UI)

### Páginas implementadas (27 rutas Astro)
```
apps/web/src/pages/
├── index.astro                              ✅
├── login.astro                              ✅
├── dashboard/index.astro                    ✅ (métricas pendientes)
├── employees/index.astro                    ✅ listado con búsqueda
├── employees/new.astro                      ✅
├── employees/[id].astro                     ✅ tabs Personal/Laboral/Préstamos
├── employees/[id]/loans/new.astro           ✅ calculadora de cuotas
├── employees/[id]/loans/[loanId].astro      ✅ editar/cerrar
├── loans/index.astro                        ✅ lista global todos los préstamos
├── loans/new.astro                          ✅ form completo + calculadora + selector empleado
├── payroll/index.astro                      ✅ lista + status pills
├── payroll/new.astro                        ✅
├── payroll/[id].astro                       ✅ stepper + tabla + acciones
├── config/conceptos/[index|new|id].astro    ✅ switch activo/inactivo
├── config/cargos/[index|new|id].astro       ✅
├── config/departamentos/[index|new|id].astro ✅ árbol
└── config/funciones/[index|new|id].astro    ✅
```

**Milestone:** Flujo completo Empleado → Planilla generada → PDF descargable desde la UI.

---

## Fase 5 — Módulos Avanzados
**Duración:** 10–15 días  
**Depende de:** Fases 3, 4

### Objetivos
- [ ] Módulo de acumulados con exportación Excel
- [ ] Reportes PDF empresariales con logo y firmas
- [ ] Sistema de tolerancias completo
- [ ] Importación masiva de empleados

### Tareas

#### 5.1 Módulo Acumulados
- Vista por empleado, por período, por concepto
- Comparativa entre períodos
- Exportación a Excel (con `exceljs`)
- Gráficas de tendencia (opcional, Chart.js)

#### 5.2 Reportes Empresariales
- Reporte planilla general (todas las empresas para super admin)
- Reporte de carga social (CSS Panamá)
- Comprobantes individuales con firma digital del empleador
- Logo y datos de empresa en cada documento

#### 5.3 Sistema de Tolerancias
- Configuración por empresa: minutos entrada, salida, almuerzo
- Tipos: flexible, estricto, por turno
- Reportes de incidencias automáticos

#### 5.4 Importación Masiva
- Carga de empleados desde Excel (template descargable)
- Validación previa con errores detallados por fila
- Importación transaccional (todo o nada)
- Módulo de documentos: subida y almacenamiento de expedientes

---

## Fase 6 — Testing, Optimización y Deploy
**Duración:** 5–7 días  
**Depende de:** Todas las fases anteriores

### Objetivos
- [ ] Cobertura de tests >70% en `packages/core`
- [ ] Docker Compose listo para producción
- [ ] Deploy funcional en plataforma cloud

### Tareas

#### 6.1 Testing con Bun:test
```
packages/core/__tests__/
├── formulas.test.ts      # Motor de fórmulas (crítico)
├── payroll.test.ts       # Cálculo de planillas
├── thirteenth.test.ts    # XIII Mes casos edge
├── vacations.test.ts     # Reglas laborales Panamá
└── attendance.test.ts    # Tolerancias y marcaciones

apps/api/__tests__/
├── auth.test.ts
├── employees.test.ts
└── payroll.test.ts
```

#### 6.2 Docker
```yaml
# docker-compose.yml
services:
  postgres:   # PostgreSQL 16
  api:        # apps/api (Bun)
  web:        # apps/web (Astro SSR)
  redis:      # Para rate limiting y cache de sesiones
```

#### 6.3 Deploy
Opciones recomendadas (en orden de preferencia):
1. **Railway** — más simple, soporte nativo a Bun y PostgreSQL
2. **Fly.io** — más control, edge computing
3. **Render** — alternativa estable

Checklist pre-producción:
- [ ] Variables de entorno en plataforma
- [ ] SSL automático
- [ ] Backups automáticos de PostgreSQL
- [ ] Monitoring básico (logs, uptime)
- [ ] Secrets rotation plan

**Milestone final:** Sistema completo en producción respondiendo requests reales.

---

## Dependencias entre Fases

```
Fase 0 (Setup)
    └── Fase 1 (DB + Core)
            └── Fase 2 (Auth)
                    └── Fase 3 (API Core)  ←─────┐
                            └── Fase 4 (Frontend) │
                                    └── Fase 5 (Avanzados)
                                            └── Fase 6 (Deploy)
                                                    
                    Fase 4 puede comenzar en paralelo
                    con Fase 3 una vez que existan los
                    primeros endpoints (employees GET)
```

---

## Paquetes NPM Clave

### Backend (`apps/api`)
| Paquete | Uso |
|---------|-----|
| `elysia` | Framework HTTP |
| `@elysiajs/jwt` | Autenticación JWT |
| `@elysiajs/cookie` | Manejo de cookies |
| `@elysiajs/cors` | CORS |
| `@elysiajs/csrf` | Protección CSRF |

### Base de Datos (`packages/db`)
| Paquete | Uso |
|---------|-----|
| `drizzle-orm` | ORM |
| `drizzle-kit` | CLI migraciones |
| `postgres` | Driver PostgreSQL |
| `zod` | Validación de schemas |

### Frontend (`apps/web`)
| Paquete | Uso |
|---------|-----|
| `astro` | Framework web |
| `@astrojs/react` | Islands React |
| `tailwindcss` | Estilos |
| `@tanstack/react-table` | DataTables |
| `@fullcalendar/react` | Calendario asistencia |
| `@react-pdf/renderer` | Generación PDFs |

### Utilitarios (`packages/utils`)
| Paquete | Uso |
|---------|-----|
| `date-fns` | Manipulación de fechas |
| `exceljs` | Exportación Excel |
| `biome` | Linter + Formatter |

---

## Decisiones Arquitectónicas Clave

### Multi-tenancy
- Estrategia: **schema separado por tenant** en PostgreSQL (`tenant_acme`, `tenant_beta`)
- Ventaja: aislamiento total de datos, fácil backup por cliente
- El schema público contiene solo `tenants` y `super_admins`

### Formula Engine
- El motor de fórmulas es el componente más crítico del sistema
- Debe portarse **primero** (Fase 1) antes de cualquier API
- Requiere tests exhaustivos antes de continuar

### Tipado end-to-end
- Usar **Eden Treaty** de Elysia para inferir tipos del backend en el frontend
- `packages/types` contiene tipos compartidos independientes del framework
- Zod como única fuente de verdad para validación + tipos

### Autenticación
- JWT en cookie httpOnly (no localStorage) para evitar XSS
- Refresh token con rotación automática
- Super Admin accede a todos los tenants via header `X-Tenant-Override`

---

## Comenzar Ahora (Fase 0)

```bash
# 1. Inicializar estructura
mkdir -p apps/api apps/web packages/db packages/core packages/types packages/utils

# 2. Inicializar workspaces
bun init

# 3. Primera app
cd apps/api && bun add elysia

# 4. Levantar dev
bun run dev
```

El primer commit debería incluir solo la estructura vacía + configuración de workspaces.
