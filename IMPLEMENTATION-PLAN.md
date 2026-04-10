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
**Estado: ✅ COMPLETO (motor de fórmulas pendiente para Fase 3c)**

### Objetivos
- [x] Todos los schemas de Drizzle creados y migrados
- [ ] Motor de Fórmulas V3.5.3 portado y funcionando ← se implementará en Fase 3c
- [x] Custom Query Builder v2 implementado
- [x] Sistema de migración por tenant (`--public`, `--tenant`, `--all-tenants`)

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

#### 2.2 Roles y Permisos
Roles base del sistema:
- `SUPER_ADMIN` — acceso total multi-tenant
- `ADMIN` — administrador de empresa
- `HR` — recursos humanos (lectura/escritura empleados)
- `ACCOUNTANT` — acceso a planillas y reportes
- `VIEWER` — solo lectura

- Tabla `roles` + `role_permissions` + `user_roles` por tenant
- Middleware `requirePermission(permission: string)`

#### 2.3 CSRF + Rate Limiting
- `@elysiajs/csrf` para endpoints mutantes
- Rate limiting por IP: 100 req/min general, 10 req/min en `/auth/login`

**Milestone:** Login multi-tenant funcional con tokens, roles asignados.

---

## Fase 3 — API Core + Business Logic
**Duración:** 10–14 días  
**Depende de:** Fases 0, 1, 2  
**Estado: 🔄 EN PROGRESO (3a ✅ 3b ✅ — 3c/3d/3e/3f pendientes)**

Esta es la fase más crítica. Contiene toda la lógica de negocio.

### Objetivos
- [x] CRUD completo de empleados con catálogos enlazados
- [x] Catálogos: Cargos, Funciones, Departamentos (árbol padre-hijo)
- [x] Conceptos de nómina (income/deduction + fórmula)
- [x] Préstamos por empleado
- [ ] Motor de nómina generando planillas correctas
- [ ] XIII Mes calculado correctamente
- [ ] Sistema de vacaciones Panamá
- [ ] Asistencia con webhooks

### Tareas

#### 3.1 Módulo Empleados ✅
```
apps/api/src/modules/employees/
├── service.ts
└── routes.ts
```
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
- [x] `GET /loans?employeeId` + `POST/PUT/DELETE /loans/:id`
- [x] Cierre de préstamo (soft-delete `isActive=false`)

#### 3c Motor de Planillas 🔲 PENDIENTE
```
packages/core/payroll/
├── engine.ts           # PayrollEngine class
├── processor.ts        # Procesa líneas de planilla
├── thirteenth.ts       # Cálculo XIII Mes
├── accumulators.ts     # Acumulados por período
└── types.ts
```

Tipos de planilla soportados:
- Quincenal / Mensual / Semanal
- Planilla especial (bonos, ajustes)
- XIII Mes (automático + manual)

Lógica XIII Mes Panamá:
- Cálculo acumulado semestral (Enero–Junio, Julio–Diciembre)
- Integración con conceptos de nómina regulares
- Histórico de pagos parciales

#### 3d XIII Mes Panameño 🔲 PENDIENTE

- Cálculo semestral acumulado (Ene–Jun, Jul–Dic)
- Regla: 1/12 del salario por mes trabajado en el período
- Endpoint dedicado + UI de vista previa y cierre

#### 3e Sistema de Asistencia 🔲 PENDIENTE
```
packages/core/attendance/
├── processor.ts        # Calcula horas, horas extra, atrasos
├── tolerances.ts       # Sistema de tolerancias configurable
├── lunch.ts            # Cálculo de descuento almuerzo
└── webhook.ts          # Handler para Base44
```
- Webhook `POST /webhooks/attendance` para integración Base44
- Procesamiento de marcaciones: entrada, salida, almuerzo
- Tolerancias configurables por empresa (minutos de gracia)

#### 3f Vacaciones Panamá 🔲 PENDIENTE
Reglas del Código de Trabajo de Panamá:
- 1 día por cada 11 trabajados (hasta 30 días)
- Balance acumulado por empleado
- Integración con planilla (pago de vacaciones)
- Historial de solicitudes y aprobaciones

**Milestone:** Generar planilla completa con XIII Mes correcto para un empleado de prueba.

---

## Fase 4 — Frontend Astro
**Duración:** 8–12 días  
**Depende de:** Fases 0, 2, 3 (parcial)  
**Estado: 🔄 EN PROGRESO (UI base + módulos 3a/3b listos — planillas/asistencia/vacaciones pendientes)**

### Objetivos
- [x] UI moderna y responsiva (Tailwind CSS, sidebar, layout base)
- [x] Empleados: lista, nuevo, editar con tabs
- [x] Catálogos: Cargos, Funciones, Departamentos, Conceptos
- [x] Préstamos: tab en empleado + páginas new/edit
- [ ] Flujo completo Empleado → Planilla → PDF
- [ ] DataTables con filtros y exportación
- [ ] Calendario de asistencia
- [ ] Módulo de vacaciones

### Tareas

#### 4.1 Design System
- Tailwind CSS + `shadcn/ui` (portado a Astro)
- Tema corporativo configurable por tenant (logo, colores)
- Componentes base: Button, Table, Modal, Form, Badge

#### 4.2 Páginas principales (Astro SSR)
```
apps/web/src/pages/
├── index.astro              # Redirect a dashboard
├── login.astro
├── dashboard/
│   └── index.astro
├── employees/
│   ├── index.astro          # Lista
│   └── [id].astro           # Detalle/edición
├── payroll/
│   ├── index.astro          # Lista de planillas
│   └── [id]/
│       ├── index.astro      # Vista planilla
│       └── pdf.astro        # Preview PDF
└── attendance/
    └── index.astro          # Calendario
```

#### 4.3 Islands Interactivos (React)
- `DataTable.tsx` — TanStack Table v8 con filtros, sort, paginación
- `PayrollForm.tsx` — Wizard de creación de planilla
- `AttendanceCalendar.tsx` — FullCalendar con localización Panamá
- `FormulaEditor.tsx` — Editor de fórmulas con syntax highlight

#### 4.4 Cliente API tipado
```typescript
// apps/web/src/lib/api.ts
// Cliente fetch tipado usando los tipos de packages/types
```
- Wrapper con manejo de errores, CSRF token automático
- Tipos inferidos desde el backend (Eden Treaty de Elysia)

#### 4.5 Generación de PDFs
- `@react-pdf/renderer` o `puppeteer` para planillas
- Templates: Planilla estándar, Recibo individual, Reporte XIII Mes
- Preview en browser antes de descargar

**Milestone:** Flujo completo Empleado → Planilla → PDF desde la UI sin errores.

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
