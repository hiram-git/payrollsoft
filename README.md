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

### Módulo de posiciones
Catálogo de posiciones que combina cargo, función, departamento y salario en una entidad reutilizable. Se asigna a empleados desde el módulo de estructura organizativa.

### Catálogos configurables
Cargos, funciones, departamentos (árbol padre-hijo), conceptos de nómina. Los catálogos se gestionan desde `/config/` con activación/desactivación sin borrado físico.

### Sistema de diseño con CSS custom properties
La interfaz usa variables CSS semánticas (`--ink`, `--fore`, `--navy`, `--ok`, `--err`, `--rule`, `--mute`, etc.) en lugar de clases utilitarias de color. El tema claro/oscuro se controla con `data-theme` en el elemento `<html>` y se persiste en `localStorage`. Las tipografías son Fraunces (encabezados display), Inter Tight (interfaz) y JetBrains Mono (código). El cambio de tema no produce destello visual gracias a un script síncrono en `<head>`.

---

## Stack técnico

| Capa | Tecnología |
|------|-----------|
| Runtime | Bun |
| Monorepo | Turborepo |
| Backend | Elysia.js |
| Frontend | Astro 6 (SSR) + CSS custom properties |
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
│   ├── web/          — Frontend SSR (Astro + Tailwind, puerto 4321)
│   └── desktop/      — Shell de escritorio (Tauri 2) que envuelve el web app
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

## Aplicación de escritorio (Tauri 2)

Además del acceso por navegador, el proyecto incluye un wrapper de
escritorio en `apps/desktop/` construido con Tauri 2. Es un shell
delgado: abre una ventana nativa que carga la URL del web app, así que
**ambos canales conviven** — el navegador sigue funcionando sin
cambios y la app de escritorio es una entrega adicional.

### Habilitar el escritorio

Se controla con dos variables nuevas en el `.env` de la raíz:

| Variable | Default | Descripción |
|----------|---------|-------------|
| `DESKTOP_ENABLED` | `false` | Gate de arranque. Sólo si es `true`/`1`/`yes`/`on` la ventana se abre; con cualquier otro valor el binario imprime un aviso y sale sin compilar Rust. |
| `DESKTOP_URL` | `http://localhost:4321` | URL que carga la ventana. En dev apunta al Astro local; en producción al host público. |

Ambas se leen **en runtime**, así que el mismo instalador
(`.dmg` / `.msi` / `.AppImage`) se repunta editando el `.env` sin
rebuild.

### Levantar en desarrollo

Requiere [prerequisitos de Tauri](https://tauri.app/start/prerequisites/)
en la máquina (Rust toolchain y libs nativas: `webkit2gtk` en Linux,
WebView2 en Windows, nada extra en macOS).

```bash
# 1. .env en la raíz
DESKTOP_ENABLED=true
DESKTOP_URL=http://localhost:4321

# 2. Levanta el web app en una terminal
bun --filter @payroll/web dev

# 3. Lanza la ventana en otra terminal
bun --filter @payroll/desktop dev
```

El script `bun run dev` de la raíz (que corre `--filter='*' dev`)
respeta el gate: si `DESKTOP_ENABLED` no es truthy, el workspace de
escritorio se salta sin tocar el toolchain de Rust, así que los
contribuidores que sólo trabajan en web/api no se ven afectados.

### Empaquetar

```bash
bun --filter @payroll/desktop build
```

Los instaladores quedan en `apps/desktop/src-tauri/target/release/bundle/`.
Ver [`apps/desktop/README.md`](./apps/desktop/README.md) para detalles
de iconos, permisos y notas de extensión (comandos JS↔Rust, acceso
filesystem, etc.).

---

## Documentación adicional

- [`PROJECT-STATUS.md`](./PROJECT-STATUS.md) — Estado actual de cada módulo, notas técnicas y referencia de la API
- [`IMPLEMENTATION-PLAN.md`](./IMPLEMENTATION-PLAN.md) — Plan de fases, tareas completadas y pendientes
- [`apps/desktop/README.md`](./apps/desktop/README.md) — Detalles del shell de escritorio (Tauri 2)
