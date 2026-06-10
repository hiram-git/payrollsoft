# Auditoría de Seguridad — `apps/mobile`

- **Alcance:** únicamente `apps/mobile` (Ionic React + Capacitor; cliente de
  marcaciones que habla **directo** con la API Elysia, sin pasar por el BFF de
  `apps/web`).
- **Fecha:** 2026-06-10
- **Tipo:** revisión estática (read-only). No se modificó código.
- **Nota de cobertura:** los proyectos nativos `android/` e `ios/` aún no se han
  generado (`cap add` no ejecutado), por lo que la revisión de
  `AndroidManifest.xml` / `Info.plist` (permisos a nivel de manifiesto) queda
  pendiente; los permisos se infieren de los plugins declarados.

> La remediación se hará en sesiones separadas. Este documento solo describe y
> clasifica. Cada hallazgo cita `archivo:línea`.

---

## 1. Resumen ejecutivo

El cliente está bien estructurado y delega la autorización en la API (que
re-verifica firma y tenant). Sin embargo, varios puntos propios del móvil
requieren atención: el **JWT de sesión se guarda sin cifrar** en Capacitor
Preferences (en kiosko es un token de usuario tenant con `facial:mark`, de alto
valor en un dispositivo compartido); el **transporte en claro está habilitado**
(`cleartext: true`, `androidScheme: 'http'`, `API_URL` por defecto `http://`) sin
HTTPS forzado ni certificate pinning; y la **integridad del marcaje biométrico**
depende de datos generados en el cliente (descriptor facial, *liveness*,
`capturedAt`, clave de idempotencia), trivialmente falsificables o replayables.
Además, el "modo kiosko" es solo lógico —sin bloqueo a nivel de SO— y su pestaña
de historial expone la asistencia de **todos** los empleados. Aspectos positivos:
no hay `console.*` (sin fugas por logs), permisos mínimos (cámara + red), el
match facial 1:1 se hace en el servidor, y `@payroll/db` se usa solo como
`import type`.

---

## 2. Hallazgos por severidad

### 🟠 ALTO

#### A-1. Token de sesión (JWT) almacenado sin cifrar

- **Archivo:línea:** `apps/mobile/src/lib/storage.ts:11,44-45` (token en
  `@capacitor/preferences`); cola offline con payloads de marcaje en
  `apps/mobile/src/lib/offline-queue.ts:49`. El propio código lo reconoce:
  `storage.ts:6-9` y `apps/mobile/NOTES.md:88-92` ("§6 Almacenamiento seguro del
  token — ⏳ PENDIENTE … Preferences **no está cifrado**").
- **Detalle:** Capacitor Preferences persiste en `SharedPreferences` (Android) /
  `UserDefaults` (iOS), ambos en **texto plano**. El JWT queda legible mediante
  backup del dispositivo, acceso físico, o root/jailbreak. En **modo kiosko** el
  token es de un **usuario tenant con permiso `facial:mark`**
  (`apps/mobile/src/lib/auth-service.ts:90-118`,
  `apps/mobile/src/pages/auth/KioskLogin.tsx:4-7`): su extracción permite marcar
  por cualquier empleado e invocar las APIs `facial:*` del tenant.
- **Impacto:** Robo de sesión y suplantación; en kiosko, compromiso de una
  credencial compartida de alto privilegio.
- **Remediación:** Migrar el token a Keychain (iOS) / Keystore (Android) vía un
  plugin de almacenamiento seguro; está centralizado en `storage.ts` para que el
  cambio sea de un solo archivo.

#### A-2. Transporte en claro permitido; sin HTTPS forzado ni certificate pinning

- **Archivo:línea:** `apps/mobile/capacitor.config.ts:19-22`
  (`androidScheme: 'http'`, `cleartext: true`);
  `apps/mobile/src/config/env.ts:10`
  (`API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000'`);
  cliente HTTP sin pinning en `apps/mobile/src/lib/api-client.ts:92`
  (`fetch(...)` directo).
- **Detalle:** `cleartext: true` habilita tráfico HTTP a nivel de red Android, y
  el `API_URL` por defecto es `http://`. No hay validación de que el endpoint sea
  HTTPS ni *certificate/public-key pinning*. Aunque el comentario indica que es
  para desarrollo en LAN, esta configuración está commiteada y se empaqueta en el
  build salvo que se sobrescriba explícitamente para producción.
- **Impacto:** Un atacante en la misma red (Wi-Fi del centro de trabajo, kiosko
  en LAN) puede interceptar/alterar tráfico: robar el JWT, leer cédulas/marcajes
  e inyectar marcaciones (MITM).
- **Remediación:** Forzar `https` en producción (`androidScheme: 'https'`,
  `cleartext: false`), validar que `API_URL` sea HTTPS, y considerar certificate
  pinning para el tráfico hacia la API.

#### A-3. Integridad del marcaje biométrico: datos generados en el cliente

- **Archivo:línea:**
  - *Liveness* heurístico 100% en cliente:
    `apps/mobile/src/lib/face-api.ts:80-112` (varianza EAR / parpadeo),
    `apps/mobile/src/components/FaceCapture.tsx:97-107`.
  - Datos confiados al servidor desde el cliente: `livenessScore`, `capturedAt`,
    `embedding`, `idempotencyKey`, `matchedEnrollmentId`, `confidence`,
    `matchDistance` — `apps/mobile/src/pages/Punch.tsx:114-123` (empleado) y
    `:303-314` (kiosko); `apps/mobile/src/lib/facial-service.ts:30-39,67-76`.
  - `punchedAt` cliente en la cola offline:
    `apps/mobile/src/lib/offline-queue.ts:80,84`.
- **Detalle:** Todo el pipeline facial corre en la WebView (JS), controlable en un
  dispositivo rooteado o instrumentando el bundle. El *liveness* es una heurística
  de apertura ocular fácilmente derrotable con un video/imagen animada, y su score
  se **envía** al servidor (que no lo valida — ver auditoría de `apps/api`, A-4).
  El `capturedAt`/`punchedAt` son del cliente sin validación de frescura, lo que
  permite **marcajes retrofechados**. Un atacante puede **reenviar (replay) un
  embedding** capturado del objetivo para que el match 1:1 del servidor lo acepte.
- **Mitigación existente:** el match facial 1:1 sí lo hace el **servidor** (el
  kiosko envía el embedding crudo y el backend lo compara contra el *enrollment*),
  y el modo empleado solo marca para sí mismo (employeeId derivado del JWT).
- **Impacto:** Fraude de asistencia (suplantación por presentación/replay,
  marcajes con hora arbitraria).
- **Remediación:** Validar frescura del timestamp en el servidor; exigir/validar
  *liveness* y anti-spoofing server-side (no confiar en el score del cliente);
  considerar firmar la captura (nonce de servidor por intento) para frustrar
  replays de embeddings.

---

### 🟡 MEDIO

#### M-1. "Modo kiosko" sin bloqueo a nivel de sistema operativo

- **Archivo:línea:** `apps/mobile/src/pages/ModeSelect.tsx:24-46`,
  `apps/mobile/src/App.tsx:56-87`, `apps/mobile/src/pages/Account.tsx:51-54,106`.
- **Detalle:** El kiosko es únicamente un *modo lógico* de la app. No hay screen
  pinning (Android `lockTask`) ni Guided Access (iOS), ni plugin que lo imponga.
  Cualquier persona frente al dispositivo puede cerrar sesión (pestaña Cuenta →
  "Cerrar sesión"), volver a `ModeSelect` y cambiar de modo, o salir de la app y
  acceder a los ajustes del dispositivo.
- **Impacto:** En un kiosko compartido se puede escapar del flujo previsto y/o
  desautenticar el dispositivo. La seguridad del kiosko depende por completo de un
  MDM externo no presente en el repositorio.
- **Remediación:** Implementar bloqueo de tarea/Guided Access (plugin nativo) y/o
  documentar el aprovisionamiento MDM obligatorio; proteger el cierre de sesión
  del kiosko con PIN del operador.

#### M-2. Historial del kiosko expone la asistencia de todos los empleados

- **Archivo:línea:** `apps/mobile/src/pages/History.tsx:7,46-47,94`
  (comentario: "en kiosko lista todo"; `employeeId = mode === 'employee' ? … :
  undefined`; render de `p.employeeName`).
- **Detalle:** En kiosko, la pestaña Historial llama
  `listTodayPunches(undefined)` → `GET /attendance/punches?date=hoy` con el JWT
  del usuario tenant, devolviendo los marcajes del día de **todos** los empleados,
  con **nombre** y hora.
- **Impacto:** Cualquiera que use el kiosko ve la asistencia (PII) de toda la
  plantilla del día.
- **Remediación:** Ocultar/limitar la pestaña Historial en modo kiosko, o exigir
  re-autenticación del operador para verla.

#### M-3. PII de marcajes en la cola offline en claro y persistente tras logout

- **Archivo:línea:** `apps/mobile/src/lib/offline-queue.ts:48-49,22`
  (`Preferences.set({ key: 'punch.queue', … })`); el logout no la borra
  (`apps/mobile/src/lib/auth-service.ts:134` → `storage.ts:79-83` solo limpia
  token/sesión/modo, no `punch.queue`).
- **Detalle:** Los payloads encolados (employeeId, tipo, timestamps) se guardan en
  Preferences sin cifrar y sobreviven al cierre de sesión, por lo que en un
  dispositivo compartido el siguiente usuario puede leerlos/reintentarlos.
- **Impacto:** Exposición de PII de marcaje en reposo en dispositivos compartidos.
- **Remediación:** Cifrar la cola (almacenamiento seguro) y limpiarla/segregarla
  por sesión; vaciar al cerrar sesión en kiosko.

---

### 🔵 BAJO

#### B-1. Endpoint y tenant horneados en el bundle del cliente

- **Archivo:línea:** `apps/mobile/src/config/env.ts:10,12`
  (`VITE_API_URL`, `VITE_TENANT` resueltos en build por Vite).
- **Detalle:** No son secretos, pero el endpoint y el tenant por defecto quedan
  fijos y visibles en el bundle empaquetado.
- **Remediación:** Aceptable; documentar que no deben colocarse secretos con
  prefijo `VITE_`.

#### B-2. WebView sin Content-Security-Policy

- **Archivo:línea:** `apps/mobile/index.html:1-18` (sin `<meta http-equiv=
  "Content-Security-Policy">`).
- **Detalle:** Una app híbrida sin CSP pierde una capa de defensa en profundidad
  (mitigación de inyección/recursos), especialmente con `cleartext` habilitado.
- **Remediación:** Añadir una CSP estricta adecuada a Capacitor.

#### B-3. `isAuthenticated` admite modo empleado sin token

- **Archivo:línea:** `apps/mobile/src/contexts/AuthContext.tsx:95`
  (`isAuthenticated = !!mode && (hasToken || !!session?.employeeId)`).
- **Detalle:** Permite entrar a `/app` con solo un `session.employeeId`
  almacenado (caso `bearerMissing`). Es solo gating de UI; las llamadas a la API
  sin token reciben 401 y disparan logout (`api-client.ts:105`).
- **Remediación:** Requerir token válido para considerar la sesión activa.

#### B-4. Dependencia de `@payroll/db` / `@payroll/core` en un cliente móvil

- **Archivo:línea:** `apps/mobile/package.json:25-27`;
  uso actual solo `import type` en `apps/mobile/src/types/domain.ts:1,17,23-24`.
- **Detalle:** Hoy es type-only (se borra en compilación, no entra al bundle),
  pero depender del paquete de base de datos del servidor en un cliente es un
  *footgun*: un `import` de valor accidental empaquetaría esquema/lógica de
  servidor.
- **Remediación:** Mover los tipos compartidos a `@payroll/types` y eliminar la
  dependencia de `@payroll/db` en el móvil.

---

## 3. Verificaciones que pasaron correctamente

- **Sin `console.*`** en `src/` → no hay fuga de tokens, cédulas, salarios ni
  payloads por logs.
- **Permisos mínimos:** solo se usan los plugins **Camera** (captura facial,
  realmente usado) y **Network** (estado de conectividad, usado). **No** se
  declara ni usa geolocalización; sin permisos sobre-declarados
  (`apps/mobile/package.json:17-22`). *(Revisión de manifiesto nativo pendiente
  por no estar generados `android/ios`.)*
- **`@payroll/db` solo como `import type`** → no se empaqueta lógica/credenciales
  de base de datos en el cliente (`apps/mobile/src/types/domain.ts:1,17`).
- **Match facial 1:1 en el SERVIDOR:** el kiosko envía el embedding crudo y el
  backend decide la coincidencia contra el *enrollment*; el cliente no resuelve el
  match (`apps/mobile/src/lib/facial-service.ts:63-76`,
  `apps/mobile/src/pages/Punch.tsx:303-314`).
- **Empleado solo marca para sí mismo:** el backend deriva el `employeeId` del
  JWT (`apps/mobile/src/lib/facial-service.ts:1-7`, confirmado en `NOTES.md:44-55`
  y auditoría de `apps/api`).
- **Idempotencia anti-duplicado:** cada marcaje lleva clave idempotente y el
  backend hace `ON CONFLICT DO NOTHING`; la cola offline no pierde ni duplica
  (`apps/mobile/src/lib/offline-queue.ts:9-11,53-57`).
- **Manejo uniforme de 401:** limpia sesión y redirige a login
  (`apps/mobile/src/lib/api-client.ts:105-108`,
  `apps/mobile/src/contexts/AuthContext.tsx:68-69`).
- **Sin persistencia de fotos faciales en disco:** `FaceCapture` solo expone el
  descriptor 128-dim; `photoUrl` es opcional y no se setea desde la captura
  (`apps/mobile/src/components/FaceCapture.tsx:22-26,103-107`).
- **Aislamiento de tenant en login de empleado:** se limpia el tenant residual y
  se fija el `tenantSlug` real resuelto por el backend antes de los requests
  autenticados (`apps/mobile/src/lib/auth-service.ts:51,68-70`).

### Observaciones (no vulnerabilidades, pero relevantes al foco solicitado)

- **Geofencing del autoservicio:** **no está implementado**. No hay
  `@capacitor/geolocation` ni captura de coordenadas; `latitude/longitude`
  aparecen solo como campos de tipo del dispositivo
  (`apps/mobile/src/types/domain.ts:84`). En consecuencia: no hay validación
  cliente-only que falsificar, ni manejo de "permiso de ubicación denegado", ni
  superficie de *GPS spoofing* en el cliente. **Si el negocio requiere geofencing
  para las marcaciones de autoservicio, la funcionalidad está ausente** y debe
  diseñarse con validación de coordenadas **en el servidor**.
- **Modo Supervisor:** es un *stub* no funcional
  (`apps/mobile/src/lib/auth-service.ts:128-132`); sin superficie de ataque hoy.
