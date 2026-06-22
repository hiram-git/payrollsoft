# @payroll/mobile — RCG SOFTRIX · App de marcaciones (Ionic React + Capacitor)

Cliente móvil para capturar marcaciones de asistencia (_punches_). Habla
**directo con la API Elysia** (`apps/api`), sin pasar por el BFF de Astro
de `apps/web`. Es un workspace hermano e independiente: reutiliza los
paquetes internos (`@payroll/types`, `@payroll/core`, tipos de
`@payroll/db`) en vez de duplicar contratos.

> Esta primera iteración es el **esqueleto navegable**: cliente HTTP,
> autenticación, captura con cola offline y el esqueleto de cámara. El
> matching facial y los flujos completos de kiosko/supervisor quedan como
> `TODO` (ver más abajo y `NOTES.md`).

## Stack

- **Ionic React 8** + **Capacitor 8**
- **React 19** (alineado con `apps/web`)
- **Vite 6** como bundler/dev server
- **Bun** como runtime y gestor de paquetes (workspaces)
- Plugins Capacitor: `Preferences` (sesión + cola), `Network`
  (conectividad), `Camera` (esqueleto facial). El geofencing del modo
  empleado usará un plugin de geolocalización más adelante; se omite por
  ahora porque `@capacitor/geolocation` crashea al arrancar en algunos
  dispositivos Samsung (ver Solución de problemas).

## Correr en desarrollo

Desde la **raíz del monorepo** (Bun reconoce el workspace
automáticamente):

```bash
bun install                      # una vez, instala todo el monorepo
bun --filter @payroll/mobile dev # arranca Vite en http://localhost:5173
```

O desde `apps/mobile`:

```bash
bun run dev          # vite dev server
bun run build        # tsc + vite build → dist/
bun run typecheck    # tsc --noEmit
bun run preview      # sirve el build de producción
```

La API debe estar corriendo (`bun --filter @payroll/api dev`, por defecto
en `http://localhost:3000`).

## Variables de entorno

Copia `.env.example` a `.env` y ajusta:

| Variable       | Descripción                                              | Default                 |
| -------------- | -------------------------------------------------------- | ----------------------- |
| `VITE_API_URL` | URL base de la API Elysia. El móvil habla directo con ella. | `http://localhost:3000` |
| `VITE_TENANT`  | Slug del tenant por defecto (header `X-Tenant`).         | `demo`                  |

> En el **emulador de Android**, `localhost` apunta al propio emulador.
> Usa la IP del host (`http://10.0.2.2:3000`) o la IP de tu máquina en la
> red local.

El tenant configurado aquí es solo el valor inicial; el tenant efectivo
se persiste por sesión tras el login (ver `src/lib/storage.ts`).

## Plataformas nativas con Capacitor

El proyecto ya trae `capacitor.config.ts` (appId
`com.payrollsoft.marcaciones`, `webDir: dist`).

> ⚠️ **Estos comandos se corren DESDE `apps/mobile`**, no desde la raíz
> del monorepo. Los scripts `cap:*` viven en `apps/mobile/package.json`;
> si ejecutas `bun run cap:add:android` desde la raíz verás
> `error: Script not found "cap:add:android"`. Usa una de estas dos vías:
>
> ```bash
> # Vía A — entra a la carpeta del móvil:
> cd apps/mobile
> bun run cap:add:android
>
> # Vía B — desde la raíz, con filtro de workspace:
> bun --filter @payroll/mobile cap:add:android
> ```

**Requisitos previos** (en tu máquina local, no en un contenedor CI):

- **Android:** JDK 17 + Android Studio / Android SDK (con `ANDROID_HOME`).
- **iOS:** macOS + Xcode + CocoaPods.

**Flujo completo** (ejemplos desde `apps/mobile`; antepón
`bun --filter @payroll/mobile` si prefieres correrlos desde la raíz):

```bash
cd apps/mobile

bun run build              # 1. genera dist/ (webDir de Capacitor) — REQUERIDO antes de add/sync

bun run cap:add:android    # 2. crea ./android (requiere toolchain de Android)
bun run cap:add:ios        #    crea ./ios     (requiere macOS + Xcode)

bun run cap:sync           # 3. copia el build web y sincroniza plugins
bunx cap open android      # 4. abre el proyecto en Android Studio / Xcode
bunx cap open ios
```

Las carpetas `android/` e `ios/` están en `.gitignore`: se regeneran con
`cap add`. Cada vez que cambies el código web, repite `bun run build &&
bun run cap:sync` para que el nativo tome la versión nueva.

### Íconos y splash (RCG SOFTRIX)

El ícono de la app y el splash se generan desde el isotipo oficial
(`public/brand/rcg-mark.png`). Los **assets fuente** viven versionados en
`apps/mobile/assets/` (icon, icon-foreground/background para íconos
adaptativos de Android, splash claro y oscuro). Los PNG multiresolución
finales se generan dentro de `android/` (gitignored), así que hay que
generarlos tras `cap add`:

```bash
bun run brand:assets   # (opcional) regenera assets/ desde el isotipo
bun run cap:add:android
bun run icons          # capacitor-assets → mipmaps + adaptive + splash
bun run cap:sync
```

`bun run icons` produce todos los tamaños (ldpi…xxxhdpi), el ícono
redondo y el adaptativo (foreground con el isotipo en zona segura +
plato blanco de fondo). Solo hace falta re-correrlo si cambia el isotipo
o recreas `android/`.

> Los cambios de backend (Bearer auth, token en el body del login, CORS y
> CSRF para orígenes Capacitor) ya están implementados en `apps/api`. Si
> pruebas el dev server del móvil en el navegador, añade su origin a
> `MOBILE_ORIGINS` en el `.env` de la API (p.ej. `http://localhost:5173`).
> Detalle en `NOTES.md`.

## Instalar el compilado en una tablet (Android)

> 🔑 **Antes de compilar: apunta `VITE_API_URL` a un host que la tablet
> pueda alcanzar.** Vite **embebe** las variables `VITE_*` en el bundle en
> tiempo de build, así que `localhost` NO sirve en un dispositivo físico.
> Usa la IP LAN de la máquina que corre la API (o una URL pública):
>
> ```bash
> # apps/mobile/.env
> VITE_API_URL=http://192.168.1.50:3000   # IP de tu PC en la red local
> VITE_TENANT=demo
> ```
>
> Y recuerda que esa IP/origen debe estar permitida en el backend
> (`MOBILE_ORIGINS` en el `.env` de la API). La tablet y la PC deben estar
> en la misma red.

Genera el bundle web y sincronízalo al proyecto nativo (desde
`apps/mobile`):

```bash
bun run build
bun run cap:sync
```

### Método A — Android Studio (recomendado para empezar)

1. En la tablet: **Ajustes → Opciones de desarrollador → Depuración USB**
   (activa Opciones de desarrollador tocando 7 veces "Número de
   compilación" en *Acerca del dispositivo*).
2. Conecta la tablet por USB y acepta el diálogo "¿Permitir depuración?".
3. Abre el proyecto: `bunx cap open android`.
4. En Android Studio elige tu tablet en el selector de dispositivos y pulsa
   **Run ▶**. Compila, instala y lanza la app en la tablet.

### Método B — APK por línea de comandos (con `adb`)

Compila un APK de depuración y instálalo:

```bash
cd android
./gradlew assembleDebug
# APK generado en:
#   android/app/build/outputs/apk/debug/app-debug.apk

# Con la tablet conectada por USB (depuración USB activada):
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

`adb` viene con el Android SDK (platform-tools). `adb devices` debe listar
tu tablet antes de instalar.

### Método C — Copiar el APK manualmente (sin cable)

1. Toma el `app-debug.apk` del paso anterior.
2. Pásalo a la tablet (USB como almacenamiento, correo, Drive, etc.).
3. En la tablet, ábrelo con el explorador de archivos y acepta
   **"Instalar apps de fuentes desconocidas"** para esa app.

> El APK de depuración (`assembleDebug`) sirve para pruebas internas. Para
> distribución real necesitas un **APK/AAB de release firmado**
> (`./gradlew assembleRelease` o `bundleRelease` con un keystore propio);
> ese flujo de firma queda fuera del alcance de esta primera iteración.

Tras cualquier cambio en el código web, repite `bun run build && bun run
cap:sync` y vuelve a instalar (Run en Android Studio o `adb install -r`).

## Los tres modos

Un solo binario, tres flujos de autenticación que comparten el núcleo
(cliente HTTP, `X-Tenant`, cámara, cola offline):

| Modo           | Para qué                                                  | Auth                                               | Estado                          |
| -------------- | --------------------------------------------------------- | -------------------------------------------------- | ------------------------------- |
| **Empleado**   | El empleado marca solo lo suyo desde su teléfono **con reconocimiento facial** (un solo botón; el backend clasifica entrada/almuerzo/salida por secuencia). | `POST /portal/auth/login` → JWT Bearer | **Funcional end-to-end**: enrolamiento + match + marcación |
| **Kiosko**     | Dispositivo compartido fijo que marca a muchos empleados **con reconocimiento facial** (cédula + verificación 1:1; el backend clasifica el tipo). | Usuario tenant con `facial:mark` (`POST /auth/login`) → JWT Bearer | **Funcional end-to-end** |
| **Supervisor** | Marcación manual supervisada y aprobaciones.              | `POST /auth/login` (usuario tenant) → JWT Bearer   | Auth desbloqueada; flujo de marcación supervisada pendiente |

### Flujo facial del empleado

1. **Primer uso:** la pantalla "Marcar" detecta que no hay enrolamiento
   y lleva a `/face-enroll`. El empleado se toma una foto, el embedding
   se manda a `POST /portal/facial/enroll`.
2. **Marcar:** el empleado toca "Marcar con cara". La cámara detecta su
   rostro + liveness por parpadeo, extrae el embedding 128-dim, lo
   manda a `POST /portal/facial/match` (verifica que sea el del JWT) y
   después a `POST /portal/facial/marcaciones`. El backend cuenta cuántas
   marcas verificadas tiene hoy y asigna el `kind`:
   - 1ª del día → `entry`
   - 2ª → `lunch_start`
   - 3ª → `lunch_end`
   - 4ª → `exit`
   - 5+ → `extra`
3. La consolidación diaria (`attendance_records`) se actualiza en vivo.

> El flujo requiere conexión a la API: el match anti-fraude se hace en el
> backend (necesita los enrollments). Si no hay red, la marcación facial
> se rechaza con un mensaje claro. Ver `NOTES.md` para el TODO de modo
> offline.

### Flujo facial del kiosko (multiempleado)

Dispositivo compartido fijo (tablet en una pared) operado por un usuario
tenant con `facial:mark`. Cada empleado marca así:

1. **Login del dispositivo (una vez):** el operador inicia con su correo +
   contraseña + empresa (`POST /auth/login`). El JWT queda guardado.
2. **Identificación:** el empleado teclea su **cédula**. El kiosko llama a
   `GET /facial/kiosk/employee?idNumber=` para resolverlo y confirmar que
   tiene cara registrada.
3. **Verificación 1:1:** la cámara captura el rostro y `POST
   /facial/kiosk/mark` verifica que la cara coincide **con ese empleado**
   (no contra todo el tenant — evita falsos positivos). Si coincide,
   registra la marca; el `kind` se clasifica por secuencia diaria igual
   que en el modo empleado.
4. Tras marcar, el kiosko vuelve a pedir cédula para el siguiente.

> El enrolamiento de cada empleado se hace desde su propio teléfono (modo
> Empleado → "Registrar mi cara") o desde la consola web. El kiosko solo
> marca; no enrola.

### Modelos face-api

Los modelos ONNX (~8 MB) viven en `apps/mobile/public/face-models/` y se
empaquetan dentro del APK; no hay descargas en runtime. Son los mismos
que usa `apps/web/public/face-models/` (kiosk web): cualquier
actualización debe hacerse en ambos lugares.

## Estructura

```
apps/mobile/
├─ capacitor.config.ts      # config nativa (appId, webDir, scheme)
├─ vite.config.ts           # dev server + alias @ → src
├─ index.html
└─ src/
   ├─ main.tsx              # bootstrap: CSS de Ionic + AuthProvider
   ├─ App.tsx               # routing + tabs (Marcar/Historial/Facial/Cuenta)
   ├─ config/env.ts         # API_URL / TENANT desde import.meta.env
   ├─ contexts/AuthContext  # estado de sesión + 401 + flush al reconectar
   ├─ lib/
   │  ├─ api-client.ts      # fetch tipado: X-Tenant + Bearer/X-Device-Token
   │  ├─ auth-service.ts    # login de los tres modos + logout
   │  ├─ attendance-service # lecturas (historial, devices)
   │  ├─ offline-queue.ts   # cola de punches: un punch nunca se pierde
   │  ├─ storage.ts         # sesión sobre Capacitor Preferences
   │  ├─ network.ts         # conectividad (Capacitor Network)
   │  └─ forms.ts           # validación reutilizando @payroll/core
   ├─ types/domain.ts       # tipos derivados de @payroll/db + DTOs de UI
   └─ pages/                # ModeSelect, auth/*, Punch, History, FacialCapture, Account
```

## Cola offline (crítico)

Toda marcación pasa por `src/lib/offline-queue.ts`. Si no hay red (o el
POST falla por red/5xx), el punch se persiste en Preferences y se
reintenta automáticamente al recuperar la conexión. Cada item lleva una
`idempotencyKey` estable, así que reintentar nunca duplica filas
(`INSERT ... ON CONFLICT DO NOTHING` en el backend). Los rechazos 4xx se
marcan como `failed` y quedan visibles en la pestaña **Cuenta** para no
perderse en silencio.

## Solución de problemas (Android)

### Crash al arrancar en Samsung por `@capacitor/geolocation` (resuelto)

Síntoma: la app muestra el logo de Capacitor y se cierra con un diálogo
de error. En `adb logcat` aparece un crash nativo (no de JS):

```
JNI DETECTED ERROR IN APPLICATION: input is not valid Modified UTF-8 ...
  in call to NewStringUTF
  from android.hardware.SystemSensorManager.nativeGetSensorAtIndex
  ... io.ionic.libs.iongeolocationlib...IONGLOCSensorHandler.<init>
  ... com.capacitorjs.plugins.geolocation.GeolocationPlugin.load
```

Causa: al cargar, el plugin Geolocation enumera los sensores del
dispositivo y en varios equipos Samsung un sensor trae un nombre con
bytes UTF-8 inválidos, lo que aborta el proceso (`SIGABRT`) antes de
pintar la UI. No es un fallo de tu código.

Solución aplicada: se quitó `@capacitor/geolocation` de las dependencias
(no se usaba todavía). Si lo reintroduces para geofencing, evalúa un
plugin alternativo o difiere su inicialización. Tras quitarlo:

```bash
bun install
bun run build && bun run cap:sync
# recrea el nativo si el plugin quedó registrado de un build anterior:
#   rm -rf android && bun run cap:add:android && bun run cap:sync
```

### La app instala pero crashea/cierra tras el splash de Capacitor

Lo primero es **ver el error real** (no adivines). Dos formas:

**A) Inspeccionar el WebView desde Chrome (mejor para errores de JS):**
1. Tablet conectada por USB con depuración USB activada.
2. En el PC abre Chrome → `chrome://inspect/#devices`.
3. Bajo la app aparece su WebView → clic en **inspect** → pestaña
   **Console**. Ahí sale el error de JavaScript en rojo.

**B) `adb logcat` (incluye errores nativos y de consola):**
```bash
adb logcat -c            # limpia el buffer
# abre la app en la tablet y reproduce el crash, luego:
adb logcat | grep -iE "chromium|Capacitor|AndroidRuntime|System.err|ReactNative"
```
Busca líneas `E/AndroidRuntime` (crash nativo) o errores `chromium`
(error de JS). Comparte ese texto para diagnóstico fino.

**Causas comunes y arreglos:**

- **Rutas de assets absolutas** → ya mitigado con `base: './'` en
  `vite.config.ts` (genera `./assets/...` en vez de `/assets/...`, que en
  el WebView nativo puede romper la carga del bundle). Si actualizas
  desde una versión vieja, vuelve a `bun run build && bun run cap:sync`.
- **Bundle desactualizado en el nativo** → siempre `bun run build` y
  luego `bun run cap:sync` antes de instalar; si dudas, borra y recrea:
  `rm -rf android && bun run cap:add:android`.
- **API por HTTP (cleartext) no responde** → Android bloquea `http://`
  por defecto. No causa el crash de arranque (la primera pantalla no
  llama a la API), pero sí rompe el login. Usa `https://`, o habilita
  cleartext para tu IP de desarrollo (ver siguiente punto).

### El login/marcación falla pero la app abre (error de red)

La tablet debe poder alcanzar la API. Revisa en orden:

1. **La API escucha en la LAN, no solo en localhost.** Arranca con
   `HOST=0.0.0.0` (es el default) y el log debe decir
   `http://0.0.0.0:3000`. Compruébalo abriendo
   `http://TU_IP_LAN:3000/health` desde el navegador **de la tablet**. Si
   no responde, es binding o firewall (en Windows, permite el puerto 3000
   / la app `bun` en el Firewall de Windows Defender).
2. **`VITE_API_URL` apunta a la IP de la PC, no a `localhost`.** En el
   dispositivo `localhost` es la propia tablet. Usa la IP LAN de tu PC
   (p.ej. `http://192.168.100.36:3000`) y recompila
   (`bun run build && bun run cap:sync`): Vite embebe esa variable en el
   bundle.
3. **Cleartext HTTP.** Android bloquea `http://` por defecto. Opciones:

- **Recomendado:** servir la API por `https://` (con un certificado o un
  túnel tipo ngrok/cloudflared) y poner esa URL en `VITE_API_URL`.
- **Desarrollo en LAN con HTTP:** habilita cleartext. Como `android/` se
  regenera, la vía durable es `capacitor.config.ts`:
  ```ts
  // capacitor.config.ts
  server: { androidScheme: 'https', cleartext: true }
  ```
  Tras cambiarlo: `bun run build && bun run cap:sync`. Verifica también
  que la IP/origen esté en `MOBILE_ORIGINS` del `.env` de la API y que
  ambos equipos estén en la misma red (prueba abriendo
  `http://IP:3000/health` desde el navegador de la tablet).

### Warnings de Gradle al compilar (no son errores)

`Using flatDir should be avoided…` y `Condition is always 'false'`
(en `IonCameraFlow.kt`) son **advertencias** del propio Capacitor/plugins,
no afectan el funcionamiento. Se pueden ignorar.

### Samsung One UI: activar Opciones de desarrollador

En Galaxy Tab A8 el "Número de compilación" está en
**Ajustes → Acerca de la tablet → Información de software** (tócalo 7
veces). Luego **Ajustes → Opciones de desarrollador → Depuración USB**.
Al conectar el cable, baja la barra de notificaciones y cambia el modo USB
de "Cargando" a **Transferencia de archivos (MTP)** si el dispositivo no
aparece en `adb devices` / Android Studio.
