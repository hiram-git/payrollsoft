# @payroll/mobile — App de marcaciones (Ionic React + Capacitor)

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
  (conectividad), `Camera` (esqueleto facial), `Geolocation` (reservado
  para geofencing del modo empleado)

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

> Los cambios de backend (Bearer auth, token en el body del login, CORS y
> CSRF para orígenes Capacitor) ya están implementados en `apps/api`. Si
> pruebas el dev server del móvil en el navegador, añade su origin a
> `MOBILE_ORIGINS` en el `.env` de la API (p.ej. `http://localhost:5173`).
> Detalle en `NOTES.md`.

## Los tres modos

Un solo binario, tres flujos de autenticación que comparten el núcleo
(cliente HTTP, `X-Tenant`, cámara, cola offline):

| Modo           | Para qué                                                  | Auth                                               | Estado                          |
| -------------- | --------------------------------------------------------- | -------------------------------------------------- | ------------------------------- |
| **Empleado**   | El empleado marca solo lo suyo desde su teléfono.         | `POST /portal/auth/login` (cédula + contraseña) → JWT Bearer | **Funcional end-to-end** (login, marcación e historial propio) |
| **Kiosko**     | Dispositivo compartido fijo que marca a muchos empleados. | Token de dispositivo (`X-Device-Token`)            | **Funcional end-to-end** (identificación facial/NFC pendiente) |
| **Supervisor** | Marcación manual supervisada y aprobaciones.              | `POST /auth/login` (usuario tenant) → JWT Bearer   | Auth desbloqueada; flujo de marcación supervisada pendiente |

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
