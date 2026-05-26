# Reconocimiento Facial — Arquitectura y Operación

Módulo de control de asistencia mediante reconocimiento facial. Se
integra con el sistema de RRHH y planilla sin modificar el motor de
cálculo: los eventos crudos del kiosko se consolidan en la tabla
existente `attendance_records`, que ya alimenta las variables del motor
de fórmulas (`MINUTOS_TARDANZA`, `MINUTOS_EXTRA`, `DIAS_TRABAJADOS`).

## Arquitectura

```
┌────────────────────────────────────────────────────────────────────┐
│                       KIOSKO (apps/desktop, Tauri 2)               │
│                                                                    │
│  Cámara → face-api (TinyFaceDetector + FaceLandmark + Recognition) │
│        → embedding 128-dim (unit-norm)                             │
│        → liveness pasivo (EAR variance, blink)                     │
│        → IndexedDB outbox (offline-first)                          │
└────────────────────────────────┬───────────────────────────────────┘
                                 │ POST /facial/match
                                 │ POST /facial/marcaciones (batch + idempotency-key)
                                 ▼
┌────────────────────────────────────────────────────────────────────┐
│                  API (Elysia + Bun, multi-tenant)                  │
│                                                                    │
│  /facial/enrollments   /facial/match   /facial/marcaciones         │
│  /facial/consolidate   /facial/dashboard   /facial/terminals       │
└──────────────┬───────────────────────────────────┬─────────────────┘
               │                                   │
               ▼                                   ▼
┌──────────────────────────────────┐ ┌─────────────────────────────────┐
│  tenant_<slug>.facial_*          │ │ packages/core attendance/       │
│  facial_enrollments (vector(128))│ │ consolidator.ts                 │
│  facial_marcaciones              │ │ (puro, sin IO, reutilizable)    │
│  facial_terminals                │ └────────────────┬────────────────┘
│  facial_terminal_events          │                  │
└──────────────┬───────────────────┘                  │
               │                                      │
               └──── consolida ──────────────────────►│
                                                      ▼
                                       tenant_<slug>.attendance_records
                                       (fuente única para planilla)
```

## Stack

| Capa | Tecnología | Notas |
|------|-----------|-------|
| Modelo | @vladmandic/face-api 1.7+ | TinyFaceDetector + FaceLandmark68 + FaceRecognition (128-d). ESM, corre en WebView. |
| Kiosko | Tauri 2 (Linux/Windows/macOS) | `DESKTOP_MODE=kiosk` arranca fullscreen en `/kiosk`. |
| Frontend admin | Astro 6 SSR | Sin cambios al Design System actual. |
| API | Elysia | Módulo `apps/api/src/modules/facial`. |
| DB | PostgreSQL | Embeddings en jsonb, matching coseno en JS. pgvector opcional para >1000 empleados. |
| ORM | Drizzle | `jsonb.$type<number[]>()` en `packages/db/src/schema/facial.ts`. |

## Modelo de datos (tenant schema)

- **`facial_enrollments`** — un row por muestra facial activa de un
  empleado. La columna `embedding jsonb` almacena un array de 128
  números. El matching coseno se ejecuta en JS (carga todos los
  embeddings activos). Para <1000 empleados es instantáneo (~1ms).
- **`facial_marcaciones`** — append-only de eventos crudos enviados por
  los kioskos. La columna `idempotency_key` garantiza que un reintento
  por red intermitente no duplique el evento (índice único parcial).
- **`facial_terminals`** — catálogo de kioskos. El token se guarda como
  hash SHA-256 y solo se devuelve en texto plano en la respuesta de
  creación / rotación.
- **`facial_terminal_events`** — heartbeats y auditoría.

`attendance_records` permanece como **fuente única** para el motor de
planilla: la consolidación escribe `checkIn`, `lunchStart`, `lunchEnd`,
`checkOut`, `workedMinutes`, `lateMinutes` y `overtimeMinutes`. El
`rawData` JSONB guarda los extras (`earlyLeaveMinutes`,
`lunchOverMinutes`, `expectedMinutes`, `status`).

## Flujo de marcación

1. El kiosko detecta un rostro y calcula el embedding 128-d.
2. Liveness pasivo: si la varianza del EAR (eye aspect ratio) en los
   últimos 30 frames es ≥ 0.06 (umbral conservador para un parpadeo),
   el frame es válido.
3. POST `/facial/match` → la API ejecuta KNN sobre `facial_enrollments`
   con la distancia coseno; si la mejor distancia ≤ 0.4, devuelve el
   match con la confianza y los datos básicos del empleado.
4. El kiosko encola un evento en IndexedDB y dispara
   POST `/facial/marcaciones` con `idempotency_key` propio. Si la red
   falla, el evento queda en la cola y se reintenta cada 20 s.
5. El servicio escribe en `facial_marcaciones` y, en el mismo request,
   consolida `attendance_records` del día/empleado afectado.

## Anti-spoofing

- Detección de blink vía variación del EAR (Eye Aspect Ratio) calculada
  sobre los 68 landmarks. Una foto impresa o pantalla congelada produce
  una varianza ≈ 0; un usuario real ≥ 0.06.
- Score de detección ≥ 0.7 obligatorio.
- Cooldown de 6 s entre marcaciones aceptadas y 2 s tras un rechazo.
- Toda marcación queda con foto opcional (si el operador habilita
  `photoUrl`) y `livenessScore` registrado.
- Para entornos de alta sensibilidad puede sumarse un modelo ONNX
  dedicado (MiniFASNet) en `apps/web/public/face-models/`; no se
  incluye por defecto (10 MB extra al bundle).

## Permisos

| Código | Rol por defecto |
|--------|----------------|
| `facial:enroll` | tenant_admin, hr |
| `facial:read`   | tenant_admin, hr, accountant, viewer |
| `facial:mark`   | tenant_admin (más cualquier rol del kiosko) |
| `facial:override` | tenant_admin, hr |
| `facial:admin`  | tenant_admin |
| `terminals:read`  | tenant_admin, hr |
| `terminals:write` | tenant_admin |

Los códigos viven en el catálogo global (`payroll_auth.permissions_catalog`) y
se siembran en cada tenant al correr la migración 0034.

## Endpoints

### Enrolamiento

```
POST   /facial/enrollments
  body: { employeeId, embedding: number[128], photoUrl?, qualityScore?, isPrimary?, notes? }

GET    /facial/enrollments?employeeId=<uuid>&status=active
DELETE /facial/enrollments/:id      # revoca (soft-delete)
```

### Matching y marcaciones

```
POST /facial/match
  body: { embedding: number[128], terminalCode?, threshold? }
  resp: { data: { matched, employeeId?, enrollmentId?, distance?, confidence?, employee? } }

POST /facial/marcaciones
  body: { items: MarcacionInput[] }   // batch, con idempotency_key por item

GET  /facial/marcaciones?date=YYYY-MM-DD&employeeId=&status=
POST /facial/marcaciones/manual     # supervisada (con justificación)
POST /facial/marcaciones/:id/justify
POST /facial/consolidate?date=YYYY-MM-DD
```

### Terminales

```
GET    /facial/terminals
POST   /facial/terminals             # 201 → { code, token }   (token se muestra UNA vez)
POST   /facial/terminals/:id/rotate  # rota el token
DELETE /facial/terminals/:id
POST   /facial/terminals/:id/heartbeat
```

### Dashboard

```
GET /facial/dashboard?date=YYYY-MM-DD
  resp: { totals: { employees, present, late, overtime, absent, marcacionesToday },
          present: PresentRow[],
          lastMarcaciones: LastMarcacion[] }
```

## Offline + idempotencia

El kiosko siempre **encola** la marcación en `localStorage` antes de
intentar enviarla. El payload incluye un `idempotencyKey` con prefijo
del código de terminal + timestamp + UUID corto. El servidor hace una
consulta por `idempotency_key` antes de insertar, así un retransmit
después de reconexión no duplica.

Política:
- `flushQueue()` se dispara al evento `online`, cada 20 s, y tras cada
  match exitoso.
- Si la red sigue caída, la marcación queda persistida hasta el siguiente
  reinicio del kiosko (se materializa en `localStorage`).

## Dispositivos soportados

El kiosko (`/kiosk`) corre en cualquier dispositivo con navegador
moderno y cámara:

| Dispositivo | Navegador | Notas |
|---|---|---|
| **PC / laptop** | Chrome, Edge, Firefox | Tauri shell o navegador directo |
| **Tablet Android** | Chrome 80+ | Requiere HTTPS. Fijar en modo kiosko con Screen Pinning |
| **iPad** | Safari 14.5+ | Requiere HTTPS. Guided Access para bloquear salida |
| **Tablet Windows** | Edge / Chrome | Soporte completo |

### Configurar tablet como kiosko

1. Abrir `https://<tu-dominio>/kiosk/setup` en el navegador de la tablet.
2. Pegar el código de terminal, tenant y token generado en `/facial/terminals`.
3. Tocar "Emparejar y abrir kiosko" — el config se guarda en localStorage.
4. **Android**: Activar Screen Pinning (Settings → Security → App pinning) para
   bloquear al usuario en Chrome.
5. **iPad**: Activar Guided Access (Settings → Accessibility → Guided Access)
   para que no pueda salir de Safari.
6. La tablet abre `/kiosk` en fullscreen con la cámara activa.

**Requisitos de red**: HTTPS obligatorio para acceder a la cámara
(`getUserMedia`). En redes LAN sin certificado, usar un proxy reverso
con Let's Encrypt o un certificado autofirmado aceptado en el
dispositivo. `localhost` también funciona sin HTTPS.

**Offline**: si la red se cae, las marcaciones quedan en localStorage
y se sincronizan automáticamente cuando la conexión regrese (flush
cada 20s + al detectar evento `online`).

## Operación

### Setup base (una vez por instalación)

```bash
# 1. Migrar (no requiere pgvector ni extensiones adicionales)
cd packages/db
bun run db:migrate:public          # registra los permisos en el catálogo
bun run db:migrate:tenant          # corre 0034_facial_recognition.sql

# 2. (Opcional) seedear permisos a usuarios existentes
# Los roles del sistema reciben los permisos automáticamente; los roles
# customizados deben editarse desde /config/roles.

# 3. Descargar modelos face-api
# Ver apps/web/public/face-models/README.md
```

### Pairing de un kiosko nuevo

1. Crear el terminal desde **/facial/terminals** → copiar el `token`
   one-shot que devuelve la API.
2. En el kiosko, abrir `/kiosk/setup`, pegar `terminal`, `tenant`, `token`.
3. El config queda en `localStorage` del WebView y `/kiosk` arranca
   automáticamente.

### Modo kiosko Tauri

```bash
DESKTOP_ENABLED=true \
DESKTOP_URL=https://app.empresa.com \
DESKTOP_MODE=kiosk \
bun run --filter @payroll/desktop dev:force
```

`DESKTOP_MODE=kiosk` hace que el shell:
- arranque fullscreen y bloquee el resize,
- redirija al path `/kiosk` automáticamente.

### Reconsolidar un día

Si se editaron marcaciones, justificaciones o se importaron eventos
fuera del flujo normal:

```
POST /facial/consolidate?date=2026-05-21
```

Lo barre por empleado y reescribe `attendance_records` desde
`facial_marcaciones` aplicando turno + calendario laboral.

## Seguridad

- **Embeddings, no fotos**: el servidor recibe el vector facial, no la
  imagen. Las fotos opcionales para auditoría se referencian via URL
  (S3 firmado, no se almacena el binario en la base).
- **Token de kiosko**: SHA-256 en reposo, rotable desde el panel.
- **CSRF**: el plugin global de la API valida el header `Origin` en
  toda llamada mutante. Los kioskos en LAN se autentican con cookie de
  sesión (`auth`) emitida durante el pairing.
- **Rate limit**: el plugin global `globalRateLimit` aplica también a
  `/facial/marcaciones`. Para entornos de >100 empleados marcando en
  simultáneo, sube el límite en `apps/api/src/middleware/rateLimit.ts`.
- **Datos biométricos en pgvector**: aislados por schema de tenant; un
  super-admin con acceso a varios tenants no puede mezclarlos por
  diseño (la conexión usa `search_path` por tenant).

## Tests

```bash
cd packages/core
bun test src/attendance/__tests__/consolidator.test.ts
```

Cubre: jornada normal, tardanza > tolerancia, horas extra, ausencia,
fin de semana fuera del shift (descanso), feriado del calendario y
almuerzo excedido.

## Stack tecnológico contra el prompt

| Requisito del prompt | Implementación |
|---|---|
| Bun + Elysia.js | `apps/api/src/modules/facial/*` |
| Astro + Tailwind | `apps/web/src/pages/facial/*`, `/kiosk/*` |
| TypeScript strict | Reutiliza el `tsconfig.json` raíz |
| Drizzle + Postgres | `packages/db/src/schema/facial.ts`, migración `0034` |
| Zod | `packages/types/src/index.ts` (esquemas exportados al servidor) |
| Design System propio | Reutiliza componentes existentes (`AppLayout`, `BaseLayout`) y tokens Tailwind del proyecto |
| Multi-tenant | Tablas en `tenant_<slug>` schema; `X-Tenant` header obligatorio |
| Sin offline → con offline | IndexedDB outbox + `idempotency_key` |
| Concurrencia alta | Dedupe por `idempotency_key`, cosine en JS |
| Soporta +500 empleados | Cosine JS <1ms para 1000 enrollments; pgvector opcional para escala |

## Performance: escalar con pgvector (opcional)

Para >1000 empleados activos, pgvector acelera el matching con un
índice HNSW. Los pasos son:

```sql
-- 1. Instalar la extensión (requiere paquete postgresql-pgvector)
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. Añadir columna vector y copiar datos desde jsonb
ALTER TABLE facial_enrollments ADD COLUMN embedding_vec vector(128);
UPDATE facial_enrollments SET embedding_vec = embedding::text::vector;

-- 3. Crear índice HNSW
CREATE INDEX facial_enrollments_hnsw
  ON facial_enrollments USING hnsw (embedding_vec vector_cosine_ops)
  WHERE status = 'active';
```

Después, actualizar `apps/api/src/modules/facial/vector.ts` para usar
`<=>` en lugar del matching en JS.
