# Plan de Implementación - PayrollSoft

**Fecha de inicio:** Abril 2026  
**Stack:** Bun • Elysia.js • Astro • Drizzle ORM • PostgreSQL  

---

## Resumen Ejecutivo

Sistema de nómina multi-empresa para Panamá. Construido como monorepo con separación clara entre motor de fórmulas (sin dependencias), capa de datos (Drizzle + query builder), API REST (Elysia) y frontend SSR (Astro). Multitenancy por schema PostgreSQL.

---

## Arquitectura del Monorepo

```
payrollsoft/
├── apps/
│   ├── api/          — Elysia + Bun (puerto 3000)
│   └── web/          — Astro SSR + Tailwind (puerto 4321)
├── packages/
│   ├── core/         — Motor de fórmulas + lógica de planilla (sin deps externas)
│   └── db/           — Drizzle ORM, schema, query builder, migraciones
├── biome.json
├── turbo.json
└── package.json
```

---

## Fase 0 — Setup Inicial
**Estado: ✅ COMPLETO**

- [x] Monorepo Turborepo con Bun workspaces (`apps/`, `packages/`)
- [x] `apps/api` — Elysia 1.4 corriendo en puerto 3000
- [x] `apps/web` — Astro 6 en modo SSR, puerto 4321
- [x] `packages/db` — Drizzle ORM + cliente multi-tenant
- [x] `packages/core` — Motor de fórmulas sin dependencias de framework
- [x] Biome (linter + formatter) + Husky pre-commit hook
- [x] Variables de entorno tipadas con Zod (`src/config/env.ts`)
- [x] `bun run dev` levanta API en `:3000` y Web en `:4321` simultáneamente

---

## Fase 1 — Base de Datos + Core Engine
**Estado: ✅ COMPLETO**

- [x] Todos los schemas Drizzle creados y migrados
- [x] Motor de fórmulas portado — lexer, parser, evaluador, 6+ funciones nativas
- [x] Custom Query Builder implementado
- [x] Sistema de migración custom con salida verbose (`--public`, `--tenant`, `--all-tenants`)

### Schemas (`packages/db/src/schema/`)

| Archivo | Tablas |
|---------|--------|
| `tenant.ts` | `tenants`, `super_admins` |
| `users.ts` | `users` |
| `employee.ts` | `employees` |
| `payroll.ts` | `payrolls`, `payroll_lines`, `payroll_acumulados`, `concepts`, `loans`, `loan_installments` |
| `creditors.ts` | `creditors` |
| `vacation.ts` | `vacation_balances`, `vacation_requests` |
| `attendance.ts` | `attendance_records`, `shifts` |
| `catalog.ts` | `cargos`, `funciones`, `departamentos` |

### Migraciones tenant (`drizzle/tenant/`)

| Tag | Contenido |
|-----|-----------|
| `0000_sour_black_crow` | Tablas base |
| `0001_fuzzy_slyde` | Catálogos (cargos, funciones, departamentos) |
| `0002_broad_invaders` | FK columns en employees |
| `0003_payroll_acumulados` | Tabla payroll_acumulados |
| `0004_normalise_payroll_status` | Status estándar en payrolls |
| `0005_ensure_payroll_acumulados` | Idempotent ensure |
| `0006_concept_config` | Config avanzada de conceptos |
| `0007_loans_extra_fields` | loanType, frequency, creditor texto, allowDecember |
| `0007_creditors_loan_installments` | Tabla loan_installments |
| `0008_company_config` | Configuración por empresa |
| `0009_creditors` | Tabla creditors + creditorId FK en loans |
| `0010_add_description_to_creditors` | Campo description en creditors |
| `0011_attendance_shifts_redesign` | Rediseño shifts: entryTime/exitTime/lunchStartTime/lunchEndTime + 8 columnas tolerancias |

### Motor de fórmulas (`packages/core/`)

```
packages/core/
├── formulas/
│   ├── lexer.ts
│   ├── parser.ts
│   └── evaluator.ts
└── payroll/
    ├── engine.ts    — processLine(), evalúa conceptos en orden income → deduction
    └── utils.ts     — countBusinessDays(), countCalendarDays(), round2()
```

Funciones nativas soportadas: `ACUMULADOS`, `CONCEPTO`, `SALDO`, `DIAS`, `INIPERIODO`, `REDONDEAR`

---

## Fase 2 — Autenticación y Seguridad
**Estado: ✅ COMPLETO**

- [x] `POST /auth/login` — JWT en cookie httpOnly `auth`
- [x] `POST /auth/logout` — limpia cookie
- [x] `GET /auth/me` — usuario autenticado
- [x] Roles jerárquicos: `VIEWER → HR → ADMIN → SUPER_ADMIN`
- [x] `guardAuth` + `guardRole(minRole)` en todas las rutas protegidas
- [x] CSRF activo en endpoints mutantes
- [x] Rate limiting: 100 req/min global, 10 req/min en login
- [x] Página `/login` con form POST y manejo de errores

---

## Fase 3 — API Core + Business Logic
**Estado: ✅ 3a ✅ 3b ✅ 3c ✅ 3g — 🔄 3e parcial — 🔲 3d/3f pendientes**

### ✅ 3a — Catálogos

- [x] Cargos: CRUD completo con código único
- [x] Funciones: CRUD completo con código único
- [x] Departamentos: árbol padre-hijo, `GET /departamentos/tree`, prevención de ciclos, bloqueo de baja si hay hijos

### ✅ 3b — Conceptos + Préstamos

- [x] `GET/POST/PUT/DELETE /concepts` — tipo income|deduction + fórmula
- [x] `POST /concepts/:id/activate` + `DELETE /concepts/:id` — toggle activo/inactivo
- [x] `GET /loans` (sin employeeId = lista global) + `GET /loans?employeeId` + `POST/PUT/DELETE /loans/:id`
- [x] Cierre de préstamo (soft-delete `isActive=false`)
- [x] Campos en `loans`: `loanType`, `frequency`, `creditorId` (FK), `allowDecember`
- [x] `listAllLoans()` — query con JOIN a `employees`

### ✅ 3c — Motor de Planillas

- [x] Tipos de planilla: `regular`, `thirteenth`, `special`
- [x] Frecuencias: `biweekly`, `monthly`, `weekly`
- [x] Máquina de estados: `created → generated → closed` (+ regenerate, revert, reopen)
- [x] `payroll_acumulados` — historial desnormalizado por empleado+concepto
- [x] Variables: SALARIO, SUELDO, FICHA, FECHAINICIO/FIN/PAGO, ANTIGUEDAD, GASTOS_REP, DIAS_TRABAJADOS, etc.
- [x] Rollback automático en caso de error durante generación o cierre
- [x] **Operaciones bulk** — eliminados todos los loops N+1 en generación, cierre y reapertura (sesión 2)
- [x] **`allowZero` en conceptos** — conceptos con monto cero se omiten del output cuando `allowZero=false` (sesión 2)
- [x] **Status `processing` recuperable** — regenerar funciona aunque la planilla quedó en estado `processing` (sesión 2)

### 🔲 3d — XIII Mes Panameño (PENDIENTE)

- [x] Tipo `thirteenth` en catálogo de planillas
- [x] `getThirteenthMonthPeriods()` — semestres Ene–Jun / Jul–Dic
- [ ] Endpoint dedicado con lógica automática ← pendiente
- [ ] UI de vista previa y cierre semestral ← pendiente

### 🔄 3e — Asistencia (PARCIALMENTE COMPLETO)

- [x] Tablas: `attendance_records`, `shifts` definidas y migradas
- [x] Rediseño `shifts`: 4 puntos (entryTime, lunchStartTime, lunchEndTime, exitTime) + tolerancias antes/después por cada punto
- [x] `GET/POST /attendance` — lista con filtros + upsert por (employeeId, date)
- [x] `GET/PUT/DELETE /attendance/:id` — editar y eliminar registro
- [x] `GET/POST /attendance/shifts` — CRUD horarios
- [x] `GET/PUT/DELETE /attendance/shifts/:id`
- [x] Cálculo automático de `workedMinutes` al guardar
- [ ] Cálculo de `lateMinutes` y `overtimeMinutes` con tolerancias ← pendiente
- [ ] Webhook `POST /webhooks/attendance` para dispositivos externos ← pendiente

### 🔲 3f — Vacaciones (PENDIENTE)

- [x] Tablas: `vacation_balances`, `vacation_requests`
- [x] `calcVacationDaysEarned()` — Regla Panamá
- [ ] Endpoints CRUD de solicitudes ← pendiente
- [ ] Integración con planilla ← pendiente

### ✅ 3g — Acreedores

- [x] Tabla `creditors` (id, code, description, conceptId, isActive)
- [x] Al `POST /creditors` → se crea automáticamente concepto de deducción vinculado
- [x] `DELETE /creditors/:id` — desactiva el acreedor y su concepto vinculado
- [x] `creditor` en loans migrado de texto libre a FK `creditorId`
- [x] Endpoints: `GET/POST /creditors`, `GET/PUT/DELETE /creditors/:id`

---

## Fase 4 — Frontend Astro
**Estado: 🔄 EN PROGRESO (~92%)**

### Completado

- [x] **Sistema de diseño con CSS custom properties** — variables semánticas de color con soporte de tema claro/oscuro. Toggle de tema en header persistido en `localStorage`. Tipografías: Fraunces (display), Inter Tight (sans), JetBrains Mono (mono).
- [x] **Sidebar jerárquico con `<details>/<summary>`** — grupos padre-hijo auto-colapsables. Auto-abierto cuando algún hijo está activo. 9 secciones: Panel / Estructura / Préstamos / Asistencia / Nómina / Reportes / Vacaciones / Liquidaciones / Configuración.
- [x] **Módulo Posiciones** (`/config/estructura`) — CRUD completo de posiciones (cargo + función + departamento + salario).
- [x] UI moderna y responsiva (CSS puro con custom properties, sin librerías de componentes)
- [x] Empleados: lista con búsqueda, nuevo, editar con tabs (Personal, Laboral, Préstamos)
- [x] Catálogos: Cargos, Funciones, Departamentos (árbol), Conceptos (toggle activo/inactivo)
- [x] Planillas: lista, nuevo, detalle con stepper + tabla + desglose colapsable por empleado
- [x] Acciones de planilla con modal de confirmación (Generar, Regenerar, Revertir, Cerrar, Reabrir)
- [x] Módulo Préstamos: lista global con búsqueda/paginación, nuevo con calculadora de cuotas, editar con tabla de cuotas
- [x] Módulo Acreedores: lista, nuevo, editar
- [x] Módulo Asistencia: lista, nuevo, editar registro
- [x] Horarios: lista con tolerancias, nuevo, editar

### Pendiente

- [ ] Dashboard con métricas reales
- [ ] PDF de planilla (descarga de recibo individual + reporte general)
- [ ] Exportación Excel de planilla generada

---

## Fase 4b — Módulo de Reportes de Planilla

**Estado: 🔄 EN PROGRESO**

Refactorización del flujo de generación de reportes a una capa reutilizable
(`apps/web/src/lib/reports/`) compuesta por:

- `payroll-data.ts` — fetcher único con manejo de auth / 404 / 5xx.
- `payroll-pdf-renderer.ts` — envuelve `renderToBuffer()` y produce la
  `Response` con los headers de descarga correctos.
- `registry.ts` — catálogo declarativo de tipos de reporte. Añadir un reporte
  nuevo = agregar una entrada y cambiar `status` a `'available'`.

Rutas:

- `/reports/payroll` — listado filtrado a planillas `generated` o `closed`
  con dropdown de reportes por fila.
- `/api/reports/payroll/:id/pdf` — ruta canónica del PDF horizontal.
- `/api/payroll/:id/pdf` — ruta legacy mantenida; delega al renderer
  compartido para no romper enlaces existentes.

### Completado

- [x] **Planilla PDF (A4 horizontal, sin límite de empleados)** — reporte
  oficial con:
  - Encabezado: logo de la empresa (placeholder "LOGO" cuando no hay),
    nombre de la empresa, título `PLANILLA <TIPO>` y la línea de período
    `Desde DD-MM-YYYY hasta DD-MM-YYYY`.
  - Tabla de 10 columnas: Empleado, Cédula, Sueldo, Ingresos, Seg. Social,
    Seg. Edu., SIACAP, ISR, Otras Ded. (acreedores + otras deducciones
    fuera de las 4 de ley), Neto.
  - Fila de TOTALES que suma todas las columnas numéricas.
  - Tres bloques de firma: Elaboración (Especialista en Nóminas),
    Revisión (Jefe de Recursos Humanos), Autorización (Director General).
    Los nombres se toman de `company_config` si están configurados.
  - Pie de página fijo: `Generado: fecha+hora exacta` y
    `Página X de Y` en todas las páginas.
- [x] Paginación eliminada — el endpoint recorre todas las páginas de
  `/payroll/:id` (pages 2..N en paralelo) hasta incluir a cada empleado
  cubierto por la planilla.
- [x] **Filtros propagados**: `search`, `department`, `employeeIds` y
  `payrollTypeId` pasan del URL de `/payroll/[id]` al endpoint PDF. La
  cookie global `payroll.activeTypeId` se usa como fallback del tipo.
- [x] Botón primario "Planilla PDF" en la vista de detalle (`/payroll/[id]`)
  construye el `href` con los filtros visibles.
- [x] Enlace "Más reportes" desde la vista de detalle hacia `/reports/payroll`.

### Pendiente (por implementar en futuras iteraciones)

- [ ] **Planilla en Excel** — exportación completa `.xlsx` con hojas de
  resumen, detalle por empleado y totales por concepto.
- [ ] **Resumen de Planilla** — reporte PDF agregado por departamento,
  tipo de concepto y comparativo mes a mes.
- [ ] **Comprobantes de pago** — PDF individual por empleado (reutilizar
  `StubPdf`), opción de zip masivo con todos los comprobantes de la planilla.
- [ ] **Enviar comprobantes de pago por email** — job asíncrono que genere
  cada comprobante y lo envíe al correo del empleado. Requiere integración
  con un proveedor SMTP/API (Resend, SES, etc.).
- [ ] **Anexo 09** — reporte oficial para la CSS (Caja de Seguro Social) con
  formato exigido por la autoridad panameña.

### Páginas implementadas (40 rutas Astro)

```
apps/web/src/pages/
├── index.astro
├── login.astro
├── dashboard/index.astro
├── employees/index.astro
├── employees/new.astro
├── employees/[id].astro
├── employees/[id]/loans/new.astro
├── employees/[id]/loans/[loanId].astro  ← tabla de cuotas con estado
├── loans/index.astro                    ← búsqueda + paginación
├── loans/new.astro
├── payroll/index.astro
├── payroll/new.astro
├── payroll/[id].astro
├── attendance/index.astro
├── attendance/new.astro
├── attendance/[id].astro
├── attendance/shifts/index.astro
├── attendance/shifts/new.astro
├── attendance/shifts/[id].astro
├── config/conceptos/index.astro
├── config/conceptos/new.astro
├── config/conceptos/[id].astro
├── config/cargos/index.astro
├── config/cargos/new.astro
├── config/cargos/[id].astro
├── config/funciones/index.astro
├── config/funciones/new.astro
├── config/funciones/[id].astro
├── config/departamentos/index.astro
├── config/departamentos/new.astro
├── config/departamentos/[id].astro
├── config/acreedores/index.astro
├── config/acreedores/new.astro
├── config/acreedores/[id].astro
├── config/estructura/index.astro        ← listado de posiciones
├── config/estructura/new.astro          ← nueva posición
└── config/estructura/[id].astro         ← editar posición
```

---

## Fase 5 — Módulos Avanzados
**Estado: 🔄 EN PROGRESO (reportes iniciados)**

- [x] Reporte PDF general de planilla (horizontal) — ver Fase 4b
- [ ] Exportación Excel de planilla (pendiente)
- [ ] Resumen de Planilla (pendiente)
- [ ] Comprobantes de pago PDF por empleado (pendiente)
- [ ] Envío de comprobantes por email (pendiente)
- [ ] Anexo 09 para la CSS (pendiente)
- [ ] XIII Mes — endpoint dedicado + UI
- [ ] Vacaciones — API y UI completa
- [ ] Webhook de asistencia + procesamiento de marcaciones con tolerancias
- [ ] Importación masiva de empleados desde Excel
- [ ] Dashboard con métricas reales

---

## Fase 6 — Testing, Docker, Deploy
**Estado: 🔲 PENDIENTE**

- [ ] Tests unitarios en `packages/core` (motor de fórmulas, planillas, XIII mes)
- [ ] Docker Compose (postgres + api + web)
- [ ] Deploy en Railway / Fly.io / Render

---

## Paquetes NPM en Uso

### Backend (`apps/api`)
| Paquete | Uso |
|---------|-----|
| `elysia` | Framework HTTP |
| `@elysiajs/jwt` | Autenticación JWT |
| `@elysiajs/cookie` | Cookies |
| `@elysiajs/cors` | CORS |
| `@elysiajs/csrf` | Protección CSRF |

### Base de Datos (`packages/db`)
| Paquete | Uso |
|---------|-----|
| `drizzle-orm` | ORM |
| `drizzle-kit` | CLI migraciones |
| `postgres` | Driver PostgreSQL |
| `zod` | Validación |

### Frontend (`apps/web`)
| Paquete | Uso |
|---------|-----|
| `astro` | Framework SSR |
| `tailwindcss` | Estilos |

---

## Decisiones Arquitectónicas

### Multi-tenancy por schema PostgreSQL
- Schema público: `tenants`, `super_admins`
- Schema por tenant: `tenant_{slug}` — resto de tablas
- Sin `.references()` en FK tenant (bug drizzle-kit con `"public"."table"`)
- Aislamiento total de datos; backups por cliente triviales

### Sistema de diseño con CSS custom properties
- Variables semánticas: `--ink` (bg base), `--fore` (texto), `--navy` (acento), `--ok`/`--err`/`--warn`, `--rule` (bordes), `--mute` (texto secundario)
- Soporte de temas claro/oscuro via `data-theme` en `<html>`; toggle en header persistido en `localStorage`
- Script síncrono en `<head>` para evitar FOIT (flash of incorrect theme)
- Sin librerías de iconos: SVG inline desde `Record<IconKey, string>`

### Frontend 100% CSS sin librerías de componentes
- No se usa TanStack Table, FullCalendar ni @react-pdf/renderer
- Lógica interactiva client-side como `<script is:inline>` en las propias páginas Astro
- Modales de confirmación con patrón `data-confirm` propio (sin librerías)
- Sidebar jerárquico con `<details>/<summary>` nativo (sin JS)

### Motor de fórmulas sin `eval`
- El paquete `core` no tiene dependencias de framework
- Lexer → Parser → Evaluador propios
- Testeable en aislamiento sin levantar API ni DB

### Autenticación
- JWT en cookie httpOnly (no localStorage) — evita XSS
- Roles jerárquicos fijos en código (no configurables por UI)
- Sin refresh tokens — JWT expira en 7 días
