# Módulo de Saldos de Tiempo (`time-balance`)

Infraestructura contable de los saldos de tiempo del colaborador. Tres saldos
anuales independientes, reiniciados cada 1 de enero:

- **`compensatory`** — Tiempo compensatorio (144 h, todos los colaboradores).
- **`disability`** — Tiempo por incapacidad propia (144 h). **Bloqueado**: ver
  Dependencias.
- **`family_disability`** — Tiempo por familiar con discapacidad (144 h, si
  tiene un dependiente activo con discapacidad registrado).

## Modelo

Ledger puro: el saldo **no se almacena**, se calcula sumando los movimientos.

- `time_balances` — una fila por `(employee_id, balance_type, year)`. Migración
  `tenant/0056_time_balances.sql`.
- `time_balance_movements` — ledger con signo. `amount_minutes > 0` = crédito,
  `< 0` = débito. Saldo disponible = `SUM(amount_minutes)`. 144 h = 8640 min.
- `time_balance_renewal_state` / `time_balance_renewal_log` — worker anual.
  Migración `tenant/0057_time_balance_renewal.sql`.

Schema Drizzle: `packages/db/src/schema/time-balance.ts`.
Cálculo puro + tests: `packages/core/src/time-balance/`.

## Piezas implementadas (fases 2.A–2.E)

| Pieza | Ubicación |
| --- | --- |
| Cálculo puro (`summarizeMovements`, `canDebit`, `resolvePeriodYear`, …) | `packages/core/src/time-balance/calculation.ts` |
| Service (`getBalance`, `creditBalance`, `debitBalance`, `initializeBalance`, `initializeYearForAllEmployees`, `syncConditionalBalance`) | `service.ts` |
| Endpoints de consulta + ajuste manual + backfill | `routes.ts` (`/time-balance/...`) |
| Hook de aprobación de incidencias | `approval-hook.ts` |
| Worker de renovación anual (start/stop/trigger/status/log) | `renewal-service.ts`, `renewal-worker.ts`, `renewal-routes.ts` |
| Backfill script | `scripts/time-balance-backfill.sh` |
| UI: pestaña Saldos en ficha de empleado | `apps/web/src/pages/employees/[id].astro` |
| UI: monitoreo del worker | `apps/web/src/pages/time-balance/renewal.astro` |

Permisos: `time_balance:read`, `time_balance:write`, `time_balance:override`
(`packages/db/drizzle/public/0011_time_balance_permissions.sql`).

### Imputación temporal (resuelto)

Los movimientos se imputan al **año del evento** (`effectiveDate`), no al de
captura (`created_at`). `creditBalance`/`debitBalance` resuelven el año con
`resolvePeriodYear(opts, currentYear())`: `year` explícito → derivado de
`effectiveDate` → año actual. El `approval-hook` ya pasa `effectiveDate` (campo
de fecha del evento por tipo, o `document_date` del expediente).

## API para el módulo de incidencias (futuro)

Listas para consumir desde los formularios de Ausencia, Tardanza, Permiso,
Hora Extra, etc.:

- `getBalance(db, employeeId, type, year?)`
- `creditBalance(db, employeeId, type, minutes, opts)` — Hora Extra acredita.
- `debitBalance(db, employeeId, type, minutes, opts)` — Ausencia/Tardanza/
  Permiso debitan. Devuelve `{ ok: false, reason: 'insufficient', ... }` si
  rechaza.
- `resolveApprover(db, delegatorUserId, date)` — identidad del aprobador con
  delegación temporal (`apps/api/src/modules/approvals/delegation-service.ts`).

---

## Pendientes para iteración futura

Estas decisiones **no afectan el modelo de datos** (el ledger por
`effective_date` ya las soporta); afectan el comportamiento al crear
movimientos y se enganchan en el **módulo de incidencias** cuando se construya.

### 1. Imputación temporal — RESUELTO

Imputación al año de `effective_date`. Ya implementado (ver arriba). Se deja
listado aquí solo como referencia de las tres decisiones originales.

### 2. Ventana retroactiva — ABIERTO

¿Hasta cuántos días después del evento se acepta justificarlo? Pasada la
ventana, la solicitud se rechaza y la incidencia queda injustificada
permanentemente.

- **Decisión abierta:** valor fijo vs. configurable por tenant, y su default.
- **Dependencia externa (RRHH):** calibrar el valor según cuántos días tarda
  hoy en papel desde el evento hasta la firma del jefe (probable default
  ~30 días).
- **Dónde vivirá:** columna en `company_config` (o tabla de configuración del
  tenant). **Sin migración hecha aún.**
- **Dónde se engancha:** validación de fecha en los formularios del módulo de
  incidencias, antes de llamar a `debitBalance`. Si el evento cae fuera de la
  ventana → rechazar con mensaje en lenguaje humano.

### 3. Saldos negativos con override del Jefe de OIRH — PARCIAL

- **Por defecto:** rechazar si el débito deja el saldo del año del evento en
  negativo.
- **Excepción:** permitir el negativo con autorización del **Jefe de OIRH**
  (no del jefe inmediato). El Jefe de OIRH ya es el actor "enterado" del flujo
  manual; usar ese rol existente, no introducir uno nuevo.

**Infraestructura parcial ya presente:**
- `debitBalance(..., { allowNegative })` rechaza por defecto y permite el
  negativo cuando `allowNegative` es `true`. El permiso `time_balance:override`
  ya existe y se otorga a `tenant_admin` y `hr`.

**Falta para la versión completa:**
- Reemplazar el booleano `allowNegative` por un override estructurado
  `override: { authorizedBy: userId; reason: string }`.
- Registrar el movimiento forzado con `movement_type: 'adjustment'` y un
  `source_type` que documente la autorización (p. ej.
  `override_oirh`), además de persistir `authorizedBy` y `reason`.
- **Dependencia externa:** confirmar con RRHH el rol concreto de "Jefe de
  OIRH" y mapearlo al permiso/rol del sistema que habilita el override.
- **Dónde se engancha:** los formularios de incidencias del módulo futuro
  pasan el override al llamar a `debitBalance` cuando el aprobador con rol de
  OIRH autoriza el negativo.
