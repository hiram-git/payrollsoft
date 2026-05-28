# Módulo de sincronización de marcaciones (attendance sync)

## 1. Visión general

Ingestar marcaciones de asistencia desde múltiples fuentes (relojes biométricos,
app móvil, NFC, entrada manual) hacia la tabla `attendance_punches`, y consolidar
automáticamente esos punches en resúmenes diarios (`attendance_records`). Todo sin
duplicar registros, con control manual del proceso y visibilidad del estado.

---

## 2. Arquitectura

### Diagrama

```
  [Manual]  [Mobile App]  [Webhook/NFC]        ← direct_write
       ↓         ↓              ↓                 (POST /attendance/punches
       └─────────┼──────────────┘                  o rutas existentes)
                 ↓
  ┌────────────────────────────────────────────┐
  │          attendance_punches                │  idempotency_key UNIQUE
  └──────────────┬─────────────────────────────┘  ON CONFLICT DO NOTHING
                 │                    ↑
                 │          INGESTION WORKERS (per-device)
                 │          ├─ txt_import: lee syncSourcePath, SHA-256
                 │          ├─ api: GET syncSourcePath?since={hwm}
                 │          └─ sdk: stub (no implementado)
                 │
                 │    CONSOLIDATION WORKER (per-tenant)
                 │    HWM = último punch.id, consolida días afectados
                 ↓
  ┌────────────────────────────────────────────┐
  │          attendance_records                │  resumen diario por empleado
  └────────────────────────────────────────────┘
```

### Categorización de fuentes

| `connectionMethod` | Categoría | Worker | Ejemplo de uso |
|---|---|---|---|
| `txt_import` | batch_ingestion | Sí — ingestion worker lee archivo TXT | Reloj biométrico ZKTeco que exporta a carpeta compartida |
| `api` | batch_ingestion | Sí — ingestion worker consulta HTTP endpoint | Reloj con API REST propia |
| `sdk` | batch_ingestion | Sí — stub, pendiente de integración | Fabricante con SDK embebido (futuro) |
| `webhook` | direct_write | No — el dispositivo empuja al backend | Lector NFC que llama `POST /attendance/punches` |
| `manual` | direct_write | No — usuario registra desde la UI | Registro manual por HR desde la web |
| `mobile_app` | direct_write | No — la app llama al endpoint | App móvil del empleado |

La categoría se **deriva** de `connectionMethod` mediante la función `isBatchIngestion()`
exportada desde `packages/types`. No hay campo `category` en la DB — la constante
`BATCH_INGESTION_METHODS` es la fuente única de verdad, consumida por API y UI.

> **webhook es direct_write** incluso si el emisor es un reloj biométrico: el dispositivo
> empuja, el sistema no jala.

### Tablas involucradas

| Tabla | Rol |
|---|---|
| `attendance_punches` | Punches individuales. `idempotency_key` UNIQUE con ON CONFLICT DO NOTHING. Purgable tras N días. |
| `attendance_records` | Resumen diario por empleado (checkIn, checkOut, workedMinutes, status). Fuente canónica para planilla. |
| `attendance_devices` | Catálogo de dispositivos per-tenant. Incluye `sync_source_path` (ruta TXT o URL API) y `api_token_hash`. |
| `attendance_ingestion_state` | Estado del ingestion worker per-device: status, intervalo, HWM (timestamp), SHA-256 del último TXT, auto_start. |
| `attendance_ingestion_log` | Historial de cada ciclo de ingesta: punches encontrados, nuevos, duplicados, errores. |
| `attendance_consolidation_state` | Estado del consolidation worker per-tenant (singleton): status, intervalo, HWM (punch ID), auto_start. |
| `attendance_consolidation_log` | Historial de cada ciclo de consolidación: punches procesados, días afectados, ausentes detectados. |

### Estrategia anti-duplicados

Dos mecanismos complementarios:

1. **High-water mark (eficiencia):** cada worker rastrea hasta dónde llegó. El ingestion
   worker usa un timestamp de la fuente; el consolidation worker usa el `id` bigserial de
   `attendance_punches`. En cada ciclo solo se procesan registros posteriores al HWM.

2. **idempotency_key + ON CONFLICT DO NOTHING (corrección):** si el HWM se atrasa por
   un error, reinicio o borde de datos, el INSERT ignora duplicados silenciosamente.
   Formato: `{deviceCode}:{employeeCode}:{YYYYMMDD_HHMMSS}`.

El HWM por sí solo podría perder registros en bordes/reinicios. La UNIQUE por sí sola
funcionaría pero reprocesaría todo el lote cada ciclo. La combinación da eficiencia +
garantía.

---

## 3. Cómo configurar un dispositivo de cada tipo

### txt_import — Reloj biométrico con exportación a TXT

1. Ir a `/attendance/devices` → "Nuevo dispositivo".
2. Campos:
   - **Código**: ej. `REL-01`
   - **Nombre**: ej. "Reloj Estacionamiento"
   - **Tipo**: Reloj biométrico
   - **Conexión**: Importar TXT
   - **Ruta de sincronización**: ruta absoluta al archivo TXT en el servidor,
     ej. `/mnt/reloj/REL-01/data.txt`
3. El archivo TXT debe seguir el formato ZKTeco/Anviz (tab-separated):

```
{employeeCode}\t{YYYY-MM-DD}\t{HH:MM:SS}\t{punchType}\t{deviceCode}
```

Donde `punchType`: 0=entrada, 1=salida almuerzo, 2=regreso almuerzo, 3=salida.
Líneas vacías y las que empiezan con `#` se ignoran. Un archivo de ejemplo
está en `docs/sample-biometric.txt`.

4. Ir a `/attendance/sync` → encontrar el dispositivo → "Iniciar".

**Optimización SHA-256:** el worker calcula el hash SHA-256 del contenido del archivo
en cada ciclo. Si el hash no cambió desde el último ciclo, se salta el parseo y la
inserción. Esto es solo optimización — si el reloj reescribe el archivo completo
cada vez (caso ZKTeco típico), el hash cambia siempre y se procesa normalmente.
La deduplicación real es siempre la `idempotency_key`.

### api — Reloj con endpoint HTTP

1. Crear el dispositivo con **Conexión**: API.
2. En **Ruta de sincronización**, poner la URL del endpoint:
   ej. `http://192.168.1.100:8080/api/punches`
3. El ingestion worker hace `GET {url}?since={hwm_iso_timestamp}`.
4. La respuesta debe ser texto en el mismo formato biométrico tab-separated que
   acepta `parseBiometricTxt()`.
5. Si la fuente no soporta el parámetro `since`, devuelve el lote completo y la
   `idempotency_key` deduplica en el INSERT. El HWM sigue siendo útil como
   optimización del lado de la query, pero no es obligatorio que la fuente lo soporte.

### sdk — Integración con SDK del fabricante (futuro)

Stub reservado. Al intentar iniciar un ingestion worker con `connectionMethod: 'sdk'`,
el sistema registra el error:

> *"SDK ingestion is not yet implemented. This feature requires a concrete manufacturer
> SDK (e.g., ZKTeco, Anviz) to be integrated. Configure the device as txt_import or
> api instead."*

Se activará cuando haya un fabricante concreto con SDK definido.

### webhook — Dispositivo que empuja punches (NFC, facial externo)

El dispositivo llama directamente a `POST /attendance/punches` con el header
`X-Device-Token` (token emitido al crear el dispositivo con conexión API/webhook).
No requiere ingestion worker — es `direct_write`.

1. Crear el dispositivo con **Conexión**: Webhook. Se genera un token API automáticamente.
2. Copiar el token (se muestra una sola vez).
3. El dispositivo llama:

```bash
curl -X POST http://localhost:3000/attendance/punches \
  -H "Content-Type: application/json" \
  -H "X-Tenant: demo" \
  -H "X-Device-Token: {token}" \
  -d '{"employeeId": "uuid-del-empleado", "punchType": 0}'
```

### manual — Registro manual desde la UI

El usuario con permiso `attendance:mark` crea un punch desde la interfaz web
(`/attendance/manual`). No requiere configuración de dispositivo para funcionar,
pero si se asocia un dispositivo con `connectionMethod: 'manual'`, el punch puede
vincularse a ese dispositivo para trazabilidad.

### mobile_app — App móvil del empleado

La app llama a `POST /attendance/punches` autenticándose con el JWT del empleado
(cookie `auth`). El backend valida que `body.employeeId === jwt.userId` — el
empleado solo puede marcar por sí mismo. Ver sección 5 para detalle del endpoint.

---

## 4. Operación del worker (control manual)

### Ingestion worker (per-device)

Desde `/attendance/sync`, sección "Ingesta de marcaciones":

- **Iniciar**: botón "Iniciar" en la tarjeta del dispositivo. Configura intervalo y
  opcionalmente auto_start en el panel de configuración (icono ⚙).
- **Detener**: botón "Detener". El HWM queda persistido en `attendance_ingestion_state`.
  Al reiniciar, continúa desde el último punto confirmado.
- **Reiniciar**: "Aplicar" en el panel de configuración aplica el nuevo intervalo y
  reinicia el timer.
- **Trigger manual**: "Ingestar ahora" ejecuta un ciclo inmediato sin esperar al timer.

### Consolidation worker (per-tenant)

Desde `/attendance/sync`, sección "Consolidación automática":

- Mismos controles: Iniciar / Detener / Consolidar ahora / ⚙ Configuración.
- El HWM es el `id` bigserial del último punch consolidado. Al detener y reiniciar,
  solo procesa punches con `id > hwm`.

### Auto-start

Si `auto_start = true` y `status = 'running'`, el worker arranca automáticamente
cuando el servidor API se inicia (función `bootstrapWorkers()` en `sync-worker.ts`).

### Dispositivo nuevo

Al registrar un dispositivo nuevo, su ingestion worker **NO arranca automáticamente**.
El usuario debe ir a `/attendance/sync` y darle "Iniciar" explícitamente, o marcar
`auto_start = true` para que arranque con el siguiente reinicio del servidor. Razón:
un dispositivo recién creado puede no tener `sync_source_path` configurado.

---

## 5. Endpoint POST /attendance/punches

### Contrato

```
POST /attendance/punches
Content-Type: application/json
X-Tenant: {tenant_slug}
```

**Payload:**

```json
{
  "employeeId": "uuid",
  "punchType": 0,
  "punchedAt": "2026-05-28T07:55:00",
  "deviceId": "uuid (opcional)",
  "source": "mobile_app (opcional, default mobile_app)",
  "idempotencyKey": "string (opcional, auto-generado si no se envía)"
}
```

- `punchType`: 0=entrada, 1=salida almuerzo, 2=regreso almuerzo, 3=salida, 9=desconocido.
- `punchedAt`: ISO 8601. Si se omite, se usa `new Date()` del servidor.

**Respuesta exitosa (201):**

```json
{
  "success": true,
  "data": {
    "created": true,
    "id": 42,
    "authMode": "employee_jwt",
    "source": "mobile_app"
  }
}
```

**Respuesta duplicado:**

```json
{
  "success": true,
  "data": {
    "created": false,
    "reason": "duplicate",
    "authMode": "device_token",
    "source": "webhook"
  }
}
```

**Códigos de error:**

| Código | Causa |
|---|---|
| 400 | Falta header X-Tenant |
| 401 | Sin auth cookie ni X-Device-Token, o token inválido |
| 403 | JWT de empleado no coincide con employeeId del payload |
| 404 | Empleado no encontrado (modo device token) |

### Autenticación: dos modos

**Modo 1 — JWT de empleado (mobile app):**

```bash
curl -X POST http://localhost:3000/attendance/punches \
  -H "Content-Type: application/json" \
  -H "X-Tenant: demo" \
  -H "Cookie: auth={jwt_del_empleado}" \
  -d '{"employeeId": "uuid-del-empleado", "punchType": 0}'
```

- La app representa al empleado.
- `body.employeeId` **debe** coincidir con `jwt.userId`. Si no coincide → 403.
- El empleado solo puede marcar por sí mismo.
- `source` por defecto: `mobile_app`.

**Modo 2 — Token de dispositivo (kiosco/NFC compartido):**

```bash
curl -X POST http://localhost:3000/attendance/punches \
  -H "Content-Type: application/json" \
  -H "X-Tenant: demo" \
  -H "X-Device-Token: {token_hex_64_chars}" \
  -d '{"employeeId": "uuid-del-empleado", "punchType": 0}'
```

- El dispositivo está registrado en `attendance_devices` con `api_token_hash`.
- El backend confía en el dispositivo para identificar al empleado (NFC badge,
  huella, foto).
- `employeeId` en el payload no se restringe al token — el dispositivo decide quién marca.
- `source` se deriva del `connectionMethod` del dispositivo via `CONNECTION_TO_SOURCE`.
- El token se genera al crear el dispositivo (conexión API o Webhook) y se puede
  rotar con `POST /attendance/devices/:id/rotate`.

### Idempotency key

Si no se envía `idempotencyKey` en el payload, se auto-genera:

```
{source}:{employeeId[0:8]}:{YYYYMMDD}_{HHMMSS}
```

Ejemplo: `mobile_app:a1b2c3d4:20260528_075500`

Dos punches del mismo empleado en el mismo segundo desde la misma fuente se
deduplicarían. Si necesitas permitir múltiples punches por segundo, envía un
`idempotencyKey` explícito.

---

## 6. Cómo probar el flujo de punta a punta

### Preparación

1. Levantar el sistema: `bun run dev` (API en :3000, Web en :4321).
2. Ejecutar migraciones si no están aplicadas: `bun run --filter @payroll/db migrate`.
3. Propagar permisos desde `/superadmin` → Roles.
4. Cerrar sesión y re-loguearse para que el JWT incluya `attendance:sync`.

### Probar ingestion worker (txt_import)

1. Ir a `/attendance/devices` → crear dispositivo:
   - Código: `REL-01`, Tipo: Reloj biométrico, Conexión: Importar TXT
   - Ruta de sincronización: ruta absoluta a `docs/sample-biometric.txt` del repo
2. Ir a `/attendance/sync` → sección "Ingesta de marcaciones".
3. Click "Ingestar ahora" en la tarjeta de REL-01.
4. Verificar en DB:

```sql
SELECT count(*) FROM attendance_punches WHERE device_id = '{uuid-del-dispositivo}';
-- Esperado: 28 (si los employee codes EMP001-EMP005 existen)
-- Si no existen: 0, y el log reporta unknownEmployees: 5

SELECT * FROM attendance_ingestion_state;
-- high_water_mark debe tener el timestamp del último punch
-- last_file_hash debe tener el SHA-256 del archivo
```

5. Click "Ingestar ahora" de nuevo → 0 punches nuevos (SHA-256 igual).
6. Click "Detener" → `status = 'stopped'` en `attendance_ingestion_state`.
7. Click "Iniciar" de nuevo → continúa desde el HWM persistido.

### Probar consolidation worker

1. En `/attendance/sync`, sección "Consolidación automática".
2. Click "Consolidar ahora".
3. Verificar:

```sql
SELECT * FROM attendance_records WHERE date IN ('2026-05-26', '2026-05-27');
-- Debe haber filas con workedMinutes, status, checkIn/checkOut calculados

SELECT * FROM attendance_consolidation_state;
-- high_water_mark debe ser el max(id) de attendance_punches
```

### Probar POST /attendance/punches

**Con JWT de empleado:**

```bash
curl -X POST http://localhost:3000/attendance/punches \
  -H "Content-Type: application/json" \
  -H "X-Tenant: demo" \
  -H "Cookie: auth={jwt}" \
  -d '{"employeeId":"{uuid-del-empleado}","punchType":0}'
```

**Con token de dispositivo:**

```bash
curl -X POST http://localhost:3000/attendance/punches \
  -H "Content-Type: application/json" \
  -H "X-Tenant: demo" \
  -H "X-Device-Token: {token_del_dispositivo}" \
  -d '{"employeeId":"{uuid-del-empleado}","punchType":0}'
```

### Verificar estados de la UI

- Sin dispositivos batch: "No hay dispositivos de ingesta (TXT/API/SDK) registrados"
- Con dispositivo detenido: indicador gris, botón "Iniciar"
- Con dispositivo corriendo: indicador verde, botón "Detener"
- Consolidación no configurada: tarjeta con "No configurado", botón "Iniciar"

---

## 7. Permisos

| Código | Protege | Roles por defecto |
|---|---|---|
| `attendance:sync` | Start/stop/restart de ambos workers, ver vista `/attendance/sync`, ejecutar trigger manual, ver logs de ingesta y consolidación | `tenant_admin`, `hr` |
| `attendance:mark` | Crear punches manuales, importar TXT (ruta legacy) | `tenant_admin`, `hr` |
| `terminals:read` | Ver lista de dispositivos | `tenant_admin`, `hr` |
| `terminals:write` | Crear/editar dispositivos, rotar tokens | `tenant_admin` |

`POST /attendance/punches` no requiere permiso explícito — se autentica por JWT
de empleado o token de dispositivo. El `guardTenantMatchesToken` middleware valida
que el tenant del JWT coincida con el header `X-Tenant`.

---

## 8. Decisiones de diseño y por qué

**Ingestion per-device, consolidation per-tenant:**
`consolidateDay()` necesita ver TODOS los punches de un empleado en un día (de cualquier
fuente) para calcular `workedMinutes`, `lateMinutes`, `overtimeMinutes` correctamente.
Si la consolidación fuera per-device, dos dispositivos con punches del mismo empleado/día
dispararían consolidaciones redundantes con información parcial.

**Dos workers separados y no uno solo:**
Permite detener ingesta sin bloquear consolidación (ej: arreglar el reloj) y viceversa
(ej: depurar reglas de turno sin perder marcaciones que siguen llegando). Cadencias
distintas: ingesta cada 5 min, consolidación cada 15 min. Diagnóstico claro: `last_error`
de cada worker indica directamente qué etapa falló.

**Categoría derivada, no campo nuevo:**
`connectionMethod` ya codifica si el sistema jala (batch) o el dispositivo empuja
(direct). Un campo `category` redundante requeriría mantener sincronizados dos valores
en cada INSERT/UPDATE. La constante `BATCH_INGESTION_METHODS` en `packages/types` es la
fuente única, consumida por API y UI.

**SHA-256 del TXT es solo optimización:**
Si el archivo TXT se reescribe completo cada ciclo (caso típico ZKTeco), el hash cambia
siempre y se salta. La deduplicación real es siempre `idempotency_key` + ON CONFLICT DO
NOTHING. El SHA-256 solo ahorra parseo+inserts cuando el archivo no fue tocado entre
ciclos (reloj apagado, fin de semana).

**Dispositivos nuevos no arrancan worker automáticamente:**
Un dispositivo recién creado puede no tener `sync_source_path` configurado. Arrancar
el worker sin ruta produciría un error inmediato. El usuario debe ir a `/attendance/sync`
y darle "Iniciar" explícitamente, o marcar `auto_start = true` para el siguiente reinicio.
