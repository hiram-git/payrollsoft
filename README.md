# PayrollSoft

Sistema de nómina multi-empresa para Panamá. Construido con Bun, Elysia, Astro y Drizzle ORM sobre PostgreSQL multi-tenant.

---

## Características principales

### Motor de fórmulas propio
Cada concepto de ingreso o deducción se define con una fórmula en un lenguaje de expresiones propio (sin `eval`). El motor incluye lexer, parser y evaluador con soporte a variables dinámicas del empleado, del período y de acumulados históricos. Las fórmulas son case-insensitive y se evalúan en orden (ingresos → deducciones) para permitir referencias entre conceptos.

### Multi-tenant por schema PostgreSQL
Cada empresa opera en un schema aislado (`tenant_{slug}`). El schema se selecciona por request via el header `X-Tenant`. No hay mezcla de datos entre empresas y los backups por cliente son triviales.

### Planillas con máquina de estados
El ciclo de vida de una planilla sigue la secuencia `created → generated → closed` con transiciones controladas (`Generar`, `Regenerar`, `Revertir`, `Cerrar`, `Reabrir`). Cada transición tiene validaciones de estado y rollback automático en caso de error.

### Acumulados históricos desnormalizados
Al cerrar una planilla se registra una fila por empleado+concepto en `payroll_acumulados`. Esto permite consultar historial sin escanear JSONB y calcular acumulados en las fórmulas (`ACUMULADOS("SUELDO", 6)`).

### Módulo de préstamos con cuotas
CRUD completo de préstamos por empleado o global. Calculadora de amortización client-side con soporte a frecuencias (semanal, quincenal, mensual) y opción de omitir descuento en diciembre. Los préstamos se vinculan a un acreedor del catálogo.

### Módulo de acreedores con concepto automático
Al crear un acreedor se genera automáticamente un concepto de deducción vinculado. El préstamo se descuenta usando ese concepto en el cálculo de planilla.

### Módulo de asistencia
Registro de marcaciones con 4 puntos: entrada, salida almuerzo, entrada almuerzo, salida. Horarios configurables con tolerancias por encima y por debajo para cada marcación. Los minutos trabajados calculados alimentan las variables del motor de fórmulas (`DIAS_TRABAJADOS`, `MINUTOS_TARDANZA`, `MINUTOS_EXTRA`).

### Roles y autenticación
JWT en cookie httpOnly. Roles jerárquicos: `VIEWER → HR → ADMIN → SUPER_ADMIN`. CSRF activo en endpoints mutantes. Rate limiting global y estricto en login.

### Catálogos configurables
Cargos, funciones, departamentos (árbol padre-hijo), conceptos de nómina. Los catálogos se gestionan desde `/config/` con activación/desactivación sin borrado físico.

---

## Stack técnico

| Capa | Tecnología |
|------|-----------|
| Runtime | Bun |
| Monorepo | Turborepo |
| Backend | Elysia.js |
| Frontend | Astro 6 (SSR) + Tailwind CSS |
| ORM | Drizzle ORM |
| Base de datos | PostgreSQL 16 |
| Validación | Zod |
| Linter/Formatter | Biome |

---

## Arquitectura del monorepo

```
payrollsoft/
├── apps/
│   ├── api/          — API REST (Elysia + Bun, puerto 3000)
│   └── web/          — Frontend SSR (Astro + Tailwind, puerto 4321)
└── packages/
    ├── core/         — Motor de fórmulas + lógica de planilla (sin dependencias externas)
    └── db/           — Drizzle ORM, schema, query builder, migraciones
```

El paquete `core` no tiene dependencias de framework, lo que lo hace testeable en aislamiento. El `query-builder` de `packages/db` centraliza todas las queries y evita SQL disperso en los módulos.

---

## Levantar en desarrollo

```bash
# Desde la raíz del monorepo
bun install
bun run dev          # levanta API en :3000 y Web en :4321 en paralelo
```

Variables de entorno requeridas (archivo `.env` en la raíz):

```env
DATABASE_URL=postgres://user:pass@localhost:5432/payrollsoft
JWT_SECRET=tu_secreto_aqui
PUBLIC_API_URL=http://localhost:3000
WEB_URL=http://localhost:4321
PORT=3000
```

---

## Migraciones

El runner propio ejecuta SQL explícito con salida verbose y tracking tag-based en `<schema>.__migrations`. Los errores de "ya existe" (tipos 42P07, 42701, etc.) se ignoran de forma idempotente.

```bash
cd packages/db

# Schema público (tenants, users)
bun --env-file=../../.env src/migrate.ts --public

# Un tenant específico
bun --env-file=../../.env src/migrate.ts --tenant=demo

# Todos los tenants activos
bun --env-file=../../.env src/migrate.ts --all-tenants
```

---

## Documentación adicional

- [`PROJECT-STATUS.md`](./PROJECT-STATUS.md) — Estado actual de cada módulo, notas técnicas y referencia de la API
- [`IMPLEMENTATION-PLAN.md`](./IMPLEMENTATION-PLAN.md) — Plan de fases, tareas completadas y pendientes
