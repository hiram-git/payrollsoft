# PayrollSoft

Sistema de nómina multi-tenant para Panamá. Monorepo Bun + Turborepo.

---

## Estado del proyecto

| Fase | Descripción | Estado |
|------|-------------|--------|
| 0 | Setup: monorepo, Elysia, Astro, Drizzle, Biome, Husky | ✅ Completo |
| 1 | DB schema + Motor de fórmulas V3.5.3 + Query Builder | ✅ Completo |
| 2 | Auth JWT + Roles + Multi-tenant | ✅ Completo |
| 3a | Empleados + Préstamos + Asistencia | ✅ Completo |
| 3b | Catálogos (cargos, departamentos, funciones, conceptos) | ✅ Completo |
| 3c | Motor de planilla + Acumulados + Máquina de estados | ✅ Completo |
| 4 | Frontend Astro — UI estilo Vercel para planillas y configuración | ✅ En curso |
| 5 | Módulos avanzados (Excel, PDFs, tolerancias, importación masiva) | 🔲 Pendiente |
| 6 | Testing, Docker, Deploy | 🔲 Pendiente |

---

## Estructura del monorepo

```
payrollsoft/
├── apps/
│   ├── api/          — Elysia REST API (Bun)
│   └── web/          — Frontend Astro + Tailwind
└── packages/
    ├── core/         — Motor de fórmulas + lógica de planilla (sin dependencias externas)
    └── db/           — Drizzle ORM, schema, query builder, migraciones
```

---

## Levantar en desarrollo

```bash
# Desde la raíz
bun install
bun run dev          # levanta API (puerto 3000) + Web (puerto 4321) en paralelo
```

Variables de entorno requeridas en `.env`:

```env
DATABASE_URL=postgres://user:pass@localhost:5432/payrollsoft
JWT_SECRET=tu_secreto_aqui
PUBLIC_API_URL=http://localhost:3000
```

---

## Migraciones

El runner personalizado ejecuta SQL explícitamente con salida verbose.

```bash
cd packages/db

# Schema público (tenants, users)
bun --env-file=../../.env src/migrate.ts --public

# Un tenant específico
bun --env-file=../../.env src/migrate.ts --tenant=demo

# Todos los tenants activos
bun --env-file=../../.env src/migrate.ts --all-tenants
```

### Tracking

Las migraciones se registran en `<schema>.__migrations` (tag-based, no hash).  
Errores "already exists" de PostgreSQL se ignoran de forma idempotente:

| Código PG | Motivo |
|-----------|--------|
| 42P07 | relation already exists |
| 42710 | object already exists |
| 42P06 | schema already exists |
| 42701 | column already exists |
| 42P16 | constraint already exists |
| 23505 | unique violation (inserts idempotentes) |

---

## Módulo de Planillas

### Máquina de estados

```
created ──[Generar]──► generated ──[Cerrar]──► closed
                          │  ▲                    │
                    [Regenerar]               [Reabrir]
                          └──┘                    │
                                                  ▼
                                              generated
```

- **Eliminar** solo está permitido desde `created`.
- **Editar** (nombre, fecha de pago) solo desde `created`.
- `draft` / `processing` / `processed` / `paid` son alias legacy (migración 0004 los normaliza).

### Endpoints API

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/payroll` | Listar planillas |
| POST | `/payroll` | Crear planilla |
| GET | `/payroll/:id` | Obtener detalle + líneas |
| PUT | `/payroll/:id` | Editar (solo en `created`) |
| DELETE | `/payroll/:id` | Eliminar (solo en `created`) |
| POST | `/payroll/:id/generate` | `created → generated` |
| POST | `/payroll/:id/regenerate` | `generated → generated` (reprocesar) |
| POST | `/payroll/:id/close` | `generated → closed` |
| POST | `/payroll/:id/reopen` | `closed → generated` |

### Tabla `payroll_acumulados`

Tabla desnormalizada generada al procesar cada planilla. Una fila por empleado+concepto. Permite consultar acumulados históricos sin escanear JSONB.

```sql
payroll_acumulados (
  id, payroll_id, employee_id,
  concept_code, concept_name, concept_type,
  amount, created_at
)
```

---

## Motor de Fórmulas

Las fórmulas de conceptos se evalúan con un intérprete propio (no `eval`). El lenguaje es **case-insensitive** (el lexer normaliza a mayúsculas).

### Variables disponibles

| Variable | Valor | Tipo |
|----------|-------|------|
| `SALARIO` / `SUELDO` / `baseSalary` | Salario base del empleado | número |
| `SALARIO_DIARIO` | `SALARIO / 30` | número |
| `FICHA` | Código del empleado (ej. `"001"`) | texto |
| `EMPLOYEE_ID` | UUID del empleado | texto |
| `DIAS_PERIODO` | Días calendario del período | número |
| `DIAS_TRABAJADOS` | Días con asistencia registrada | número |
| `DIAS_HABILES` | Días hábiles del período | número |
| `DIAS_AUSENCIA` | `DIAS_HABILES - DIAS_TRABAJADOS` | número |
| `HORAS` | `DIAS_TRABAJADOS * 8` | número |
| `HORAS_EXTRA` | Minutos extra / 60 | número |
| `MINUTOS_EXTRA` | Minutos extra registrados | número |
| `MINUTOS_TARDANZA` | Minutos de tardanza registrados | número |
| `ANTIGUEDAD` | Años desde `hire_date` al inicio del período | número decimal |
| `ANTIGUEDAD_DIAS` | Días desde `hire_date` al inicio del período | número |
| `FECHAINICIO` | Inicio del período en formato `YYYYMMDD` (ej. `20240115`) | número |
| `FECHAFIN` | Fin del período en formato `YYYYMMDD` | número |
| `FECHAPAGO` | Fecha de pago en `YYYYMMDD` (0 si no definida) | número |
| `GASTOS_REP` / `GASTOS_REPRESENTACION` | `employee.customFields.gastos_rep` | número |
| `<CODIGO_CONCEPTO>` | Resultado de un concepto anterior (ej. `SUELDO`, `HE`) | número |
| `<custom_field>` | Cualquier campo de `customFields` del empleado (numérico) | número |

> **Nota sobre fechas:** Se exponen como enteros `YYYYMMDD` para que las comparaciones funcionen: `SI(FECHAINICIO > 20240101, ...)`.

### Funciones disponibles

| Función | Descripción |
|---------|-------------|
| `SI(cond, si_verdadero, si_falso)` | Condicional |
| `CONCEPTO("CODIGO")` | Valor calculado de otro concepto en esta misma línea |
| `ACUMULADOS("CODIGO", periodos)` | Suma histórica del concepto en los últimos N períodos cerrados |
| `DIAS("TRABAJADOS"\|"HABILES"\|"AUSENCIA"\|"PERIODO")` | Días según tipo |
| `MIN(a, b)` / `MAX(a, b)` / `ABS(x)` / `REDONDEAR(x, dec)` | Matemáticas |

### Ejemplos de fórmulas

```
SALARIO                                      -- sueldo completo
SALARIO * 0.5                                -- quincena
SALARIO / DIAS_HABILES * DIAS_TRABAJADOS     -- proporcional a asistencia
SI(ANTIGUEDAD >= 5, SALARIO * 0.05, 0)       -- bono por antigüedad
ACUMULADOS("SUELDO", 12) / 12               -- promedio salarial anual
baseSalary * 0.0975                          -- aporte CSS empleado
```

---

## Catálogo de Conceptos

Los conceptos de nómina (ingresos y deducciones) se gestionan en `/config/conceptos`.

- **Activo / Inactivo:** controlado mediante un switch toggle en la pantalla de edición.
- Solo los conceptos **activos** (`is_active = true`) se incluyen en el cálculo de planillas.
- La API expone `POST /concepts/:id/activate` y `DELETE /concepts/:id` (desactiva) como rutas dedicadas con operaciones Drizzle directas sobre `is_active`.

---

## Multi-tenancy

Cada empresa opera en su propio schema de PostgreSQL (`tenant_<slug>`).  
El schema se selecciona por request via header `X-Tenant: <slug>`.  
El `search_path` de la conexión se establece como `tenant_<slug>,public`.

Las tablas del schema `public` contienen: `tenants`, `users`, `tenant_users`.  
Las tablas de cada tenant contienen: `employees`, `payrolls`, `concepts`, `loans`, `attendance`, etc.

---

## Roles

| Rol | Permisos |
|-----|----------|
| `VIEWER` | Solo lectura |
| `HR` | Crear/editar empleados, conceptos, generar planillas |
| `ADMIN` | Todo lo anterior + cerrar/reabrir planillas, eliminar registros |
| `SUPER_ADMIN` | Gestión de tenants y usuarios del sistema |

---

## Decisiones técnicas relevantes

- **Fórmulas seguras:** el motor usa un lexer + parser + evaluator propios. No hay `eval()` ni `new Function()`. Las fórmulas se compilan a AST y se cachean.
- **Migraciones custom:** se reemplazó el `migrate()` de Drizzle por un runner propio con tracking tag-based en `__migrations`. Motivo: el runner nativo no tenía salida verbose y tenía comportamientos no deterministas en entornos multi-tenant.
- **Salarios como string:** `base_salary` se almacena como `VARCHAR(20)` para evitar pérdida de precisión en cálculos flotantes. Se convierte a `Number` solo dentro del motor.
- **Forms HTML sin anidar:** las acciones de toggle (activar/desactivar conceptos, transiciones de planilla) usan formularios independientes. HTML no permite `<form>` anidados; hacerlo causa que el browser ignore el form interno y envíe el externo.
