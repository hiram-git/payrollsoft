# Auditoría de Seguridad — `apps/desktop`

- **Alcance:** únicamente `apps/desktop` (Tauri 2, shell de escritorio para
  Windows que envuelve la app web de PayrollSoft en una ventana nativa).
- **Fecha:** 2026-06-10
- **Tipo:** revisión estática (read-only). No se modificó código.
- **Arquitectura:** shell delgado. Una boot page local (`src/index.html`) recibe
  la URL destino inyectada por Rust (`window.__PAYROLL_TARGET__`), prueba
  conectividad y navega (`location.replace`) a `DESKTOP_URL` (la app web remota).
  No hay lógica de negocio en el cliente de escritorio.

> La remediación se hará en sesiones separadas. Este documento solo describe y
> clasifica. Cada hallazgo cita `archivo:línea`.

---

## 1. Resumen ejecutivo

El shell de escritorio tiene una superficie de ataque **mínima y bien acotada**:
no expone comandos Rust personalizados, no habilita plugins de filesystem/shell,
usa capabilities solo del core, y no concede acceso IPC al origen web remoto
(default-deny correcto). No hay secretos hardcodeados, ni logs sensibles, ni
almacenamiento local propio de credenciales/nómina. Los hallazgos residuales son
de configuración y **heredan riesgo de la app web remota que se carga**: la CSP
de la app está deshabilitada (`"csp": null`) y no se fuerza HTTPS para la URL
destino, por lo que un XSS en la web o un MITM sobre HTTP se ejecutarían dentro
de la ventana nativa de confianza. No existe mecanismo de auto-actualización
(no hay updater configurado).

---

## 2. Hallazgos por severidad

### 🟡 MEDIO

#### M-1. CSP de la aplicación deshabilitada (`"csp": null`)

- **Archivo:línea:** `apps/desktop/src-tauri/tauri.conf.json:14-16`
  (`"security": { "csp": null }`).
- **Detalle:** Con `csp: null`, Tauri no inyecta ninguna Content-Security-Policy
  en el webview de la aplicación. La boot page sí trae su propia meta CSP
  (`apps/desktop/src/index.html:5`), pero esa política solo aplica a `index.html`;
  una vez que la boot page navega a la app remota
  (`apps/desktop/src/index.html:83`, `window.location.replace(target)`), rige la
  CSP que envíe el servidor remoto — y la auditoría de `apps/web` constató que no
  emite headers de seguridad y tiene XSS por `set:html`.
- **Impacto:** Un XSS en la app web (o contenido inyectado vía MITM si se sirve
  por HTTP) se ejecuta dentro de la ventana de escritorio de confianza, con la
  apariencia legítima de "PayrollSoft".
- **Remediación:** Definir una CSP estricta en `tauri.conf.json`
  (`app.security.csp`) acorde a los orígenes/recursos que la app necesita.

#### M-2. No se fuerza HTTPS para la URL destino

- **Archivo:línea:** `apps/desktop/src-tauri/src/lib.rs:86-102`
  (`resolve_target_url` hace `Url::parse(raw)` sin validar el esquema);
  `apps/desktop/src-tauri/src/lib.rs:9`
  (`DEFAULT_URL = "http://localhost:4321"`).
- **Detalle:** La URL destino (runtime `DESKTOP_URL` o valor horneado en build) se
  acepta con cualquier esquema; no se exige `https`. Una instalación apuntada a
  `http://…` cargaría la app de nómina (login, salarios, cédulas) sobre texto
  plano. La documentación de `build-dist` usa `https`, pero nada lo impone.
- **Impacto:** Credenciales y datos de nómina viajando en claro; MITM en la red
  corporativa puede robar la sesión o inyectar contenido (ver M-1).
- **Remediación:** Exigir `https` en producción (permitir `http` solo para
  `localhost`/dev) y rechazar el arranque con un esquema inseguro fuera de dev.

---

### 🔵 BAJO

#### B-1. Archivo `.env` de override repunta la app sin recompilar

- **Archivo:línea:** `apps/desktop/src-tauri/src/lib.rs:23-27`
  (`%APPDATA%\PayrollSoft\.env`), `:36-45` (override + junto al ejecutable + walk
  del CWD), `:87` (`DESKTOP_URL` resuelto desde ese entorno).
- **Detalle:** Cualquier proceso con permisos del usuario (p.ej. malware local)
  puede crear/editar `%APPDATA%\PayrollSoft\.env` para repuntar `DESKTOP_URL` a un
  host malicioso. La ventana nativa "PayrollSoft" seguiría luciendo legítima,
  convirtiéndose en un vector de phishing/robo de credenciales.
- **Impacto:** Requiere acceso de escritura local (no remoto), por eso es bajo.
- **Remediación:** Fijar/validar el host esperado contra una allowlist, o firmar
  la configuración distribuida; advertir si la URL difiere del valor horneado.

#### B-2. Sin mecanismo de actualización (updater ausente)

- **Archivo:línea:** `apps/desktop/src-tauri/tauri.conf.json` (sin
  `plugins.updater`); `apps/desktop/src-tauri/Cargo.toml:21-26` (sin
  `tauri-plugin-updater`).
- **Detalle:** No hay auto-updater. Esto **elimina** el riesgo de actualizaciones
  sin firma (no hay canal de updates que falsificar), pero tampoco existe un canal
  seguro: las actualizaciones son MSI manuales, lo que puede retrasar parches.
- **Impacto:** Bajo (operativo). Riesgo si en el futuro se añade un updater sin
  verificación de firma.
- **Remediación:** Si se incorpora updater, configurar verificación de firma
  (`pubkey`) y endpoints `https`; documentar el proceso de parcheo mientras tanto.

#### B-3. `connect-src *` en la CSP de la boot page

- **Archivo:línea:** `apps/desktop/src/index.html:5`
  (`content="default-src 'self' 'unsafe-inline'; connect-src *;"`).
- **Detalle:** La boot page permite `fetch` a cualquier host; se usa solo para
  probar la conectividad del `target` (`index.html:81`). Impacto limitado porque
  la boot page no maneja datos sensibles.
- **Remediación:** Acotar `connect-src` a la URL destino configurada.

#### B-4. Feature `devtools` habilitable en builds release

- **Archivo:línea:** `apps/desktop/src-tauri/Cargo.toml:15-19`
  (`devtools = ["tauri/devtools"]`); ítem de menú DevTools en
  `apps/desktop/src-tauri/src/lib.rs:143` y handler `:236-247`.
- **Detalle:** En release sin la feature, DevTools no se abre (gateado por
  `#[cfg(any(debug_assertions, feature = "devtools"))]`). Pero un build de QA
  compilado con `--features devtools` permitiría inspeccionar la sesión remota de
  nómina desde el menú "Ver".
- **Remediación:** No distribuir builds con `devtools` a usuarios finales;
  restringirlo a QA interno.

#### B-5. "Modo kiosko" sin endurecimiento a nivel de SO

- **Archivo:línea:** `apps/desktop/src-tauri/src/lib.rs:192,213`
  (`fullscreen(kiosk)`), menú con "Salir"/reload/devtools
  (`apps/desktop/src-tauri/src/lib.rs:111-160`).
- **Detalle:** El modo kiosko solo pone la ventana en pantalla completa; el menú
  nativo sigue ofreciendo Salir, Recargar y (según build) DevTools, y no hay
  bloqueo a nivel de SO (Alt+F4, gestor de tareas). La seguridad del kiosko
  depende de un MDM/configuración externa no presente en el repo.
- **Remediación:** Para kioscos reales, deshabilitar el menú/atajos y aprovisionar
  bloqueo del SO; documentar el requisito de MDM.

---

## 3. Verificaciones que pasaron correctamente

- **Sin comandos `#[tauri::command]` personalizados:** no hay superficie IPC a
  medida hacia Rust ni acceso a filesystem/shell desde el webview
  (`apps/desktop/src-tauri/src/lib.rs` no define comandos).
- **Capabilities mínimas:** solo `core:default`, `core:window:default`,
  `core:webview:default` (`apps/desktop/src-tauri/capabilities/default.json:6`).
  No se habilitan plugins de fs, shell, http ni dialog.
- **El origen remoto NO obtiene acceso IPC:** no se configura
  `dangerousRemoteDomainIpcAccess` ni `withGlobalTauri`, y la capability no lista
  dominios `remote`; por defecto la app web remota no recibe `__TAURI__`/`invoke`.
  (El intento `window.__TAURI_INTERNALS__.invoke('plugin:process|exit', …)` en
  `apps/desktop/src/index.html:94-95` ni siquiera está permitido por las
  capabilities y degrada a `window.close()`.)
- **Sin secretos hardcodeados** en código Rust, boot page ni scripts de build.
- **Sin logs de datos sensibles:** solo se imprime la URL destino (un endpoint,
  no un secreto) por stderr (`apps/desktop/src-tauri/src/lib.rs:188`).
- **Sin almacenamiento local de credenciales/nómina por el shell:** la sesión vive
  en el WebView embebido (cookies `httpOnly` gestionadas por el WebView del SO);
  la app de escritorio no persiste datos por su cuenta.
- **Navegación por menú segura:** las URLs se serializan con
  `serde_json::to_string` antes de pasarlas a `eval`, evitando inyección JS
  (`apps/desktop/src-tauri/src/lib.rs:202-205,229-233`).
- **Scripts de build sin riesgo de runtime:** `build-dist.mjs` y `dev-guard.mjs`
  se ejecutan en tiempo de build con argumentos del desarrollador; no se empaquetan
  en la app ni procesan entrada de usuario final.
- **DevTools deshabilitadas en release** salvo feature explícita
  (`apps/desktop/src-tauri/src/lib.rs:236-247`); consola oculta en release
  (`apps/desktop/src-tauri/src/main.rs:2`).
- **Gate de arranque `DESKTOP_ENABLED`:** el shell rehúsa lanzarse si no está
  habilitado (`apps/desktop/src-tauri/src/lib.rs:166-178`).
- **Tauri 2.11.1** (`apps/desktop/src-tauri/Cargo.lock`) — versión reciente de la
  rama 2.x; dependencias mínimas (`serde`, `serde_json`, `dotenvy`, `url`).
