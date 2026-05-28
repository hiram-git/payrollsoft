# @payroll/desktop

Shell de escritorio (Tauri 2) para PayrollSoft. Es un wrapper delgado: abre
una ventana nativa que carga la URL del web app (`apps/web`). La app web sigue
disponible desde el navegador; el escritorio es un canal adicional, no un
reemplazo.

**Alcance v1:** solo Windows (`.msi`). La lógica vive en el servidor, así que
la app de escritorio tiene **paridad total** con la web — todo lo que funciona
en el navegador funciona en la ventana. macOS y Linux quedan fuera de v1 (se
habilitan agregándolos a `bundle.targets` y compilando en una máquina de cada
plataforma).

## Cómo se activa

Se controla con dos variables en el `.env` de la raíz del monorepo:

| Variable | Descripción |
|----------|-------------|
| `DESKTOP_ENABLED` | Gate de arranque. Sólo si es `true`/`1`/`yes`/`on` la ventana se abre. Con cualquier otro valor el binario imprime un aviso y sale (exit 0). También controla `tauri dev`/`build` vía `scripts/dev-guard.mjs`. |
| `DESKTOP_URL` | URL que carga la ventana. Por defecto `http://localhost:4321`. En producción apuntar al host público. |

Ambas se leen **en runtime**, así que el mismo `.msi` se repunta a otro
servidor editando el `.env` — no hace falta reempaquetar.

### Por qué casi nunca hay que redistribuir el `.exe`

Como el wrapper solo carga una URL remota, los cambios en el frontend o el
backend del sistema llegan a los usuarios al refrescar la ventana. El `.msi`
solo se reempaqueta cuando cambia el **wrapper en sí** (código Rust, ventana,
menú, iconos), que es raro. Por eso v1 no incluye auto-updater.

## Desarrollo

Requisitos: Rust toolchain (`cargo` ≥ 1.77) y las dependencias nativas de
Tauri para tu plataforma (ver
[tauri.app/start/prerequisites](https://tauri.app/start/prerequisites/)).
En Windows: Microsoft C++ Build Tools y WebView2 (preinstalado en Win 11 y
Win 10 reciente).

```bash
# 1. Levanta el web app en otra terminal
bun --filter @payroll/web dev

# 2. En el .env de la raíz
DESKTOP_ENABLED=true
DESKTOP_URL=http://localhost:4321

# 3. Lanza la ventana
bun --filter @payroll/desktop dev
```

> `bun run dev` en la raíz (que corre `--filter='*' dev`) respeta el gate: si
> `DESKTOP_ENABLED` no es truthy, el workspace de escritorio se salta sin tocar
> el toolchain de Rust. Quien solo trabaja en web/api no se ve afectado.

Para forzar el arranque ignorando el guard (útil al depurar el guard mismo):
`bun --filter @payroll/desktop dev:force`.

## Build del instalador (Windows)

El bundler de `.msi` requiere correr en **Windows** (usa WiX). En Linux/macOS
se puede compilar el binario para validar el código, pero no producir el
`.msi`.

```bash
# En una máquina Windows, con DESKTOP_ENABLED=true en el .env:
bun --filter @payroll/desktop build
```

El instalador queda en
`apps/desktop/src-tauri/target/release/bundle/msi/`.

Para validar solo la compilación sin generar instalador (cualquier SO con los
prerequisitos):

```bash
cd apps/desktop && bunx tauri build --no-bundle
```

### DevTools en builds de QA

Los DevTools están disponibles en debug (`tauri dev`) vía el menú
**Ver → DevTools** (F12). Para un `.msi` de QA interno con DevTools activo,
compilar con la feature: `bunx tauri build -- --features devtools`.

## ⚠️ Validación obligatoria antes de considerar la app "lista"

Estos dos puntos **no son trámite**, son riesgos reales que solo se detectan
fuera del entorno de desarrollo. No marcar la app como lista sin cerrarlos:

1. **Auth dentro del webview contra producción REAL con subdominios.**
   En dev local (`localhost:4321`) la cookie `auth` (httpOnly, SameSite=Lax)
   funciona porque web y API comparten origen. En producción con
   `app.example.com` + `api.example.com` el dominio de la cookie se fija
   implícitamente al origen del login y **puede no enviarse** a la API en otro
   subdominio. Hay que **probar el login completo dentro de la ventana Tauri
   apuntando al entorno de producción**, no solo en localhost. Si falla,
   configurar el `Domain` de la cookie en el backend (p. ej. `.example.com`).

2. **Primer build en máquina Windows real.**
   El scaffold Rust se valida con `cargo check`/`tauri build --no-bundle` en
   Linux (CI), pero el `.msi` solo se produce en Windows con WiX y WebView2.
   El **primer build en Windows es parte de la validación** y puede revelar
   problemas de toolchain (Build Tools faltantes, WebView2 ausente, firma).
   Reservar tiempo para esto antes de prometer una fecha de entrega.

## Notas

- Los iconos en `src-tauri/icons/` son placeholders ("PS" sobre fondo navy,
  `#0B1F3A`). Reemplazarlos por el arte real del proyecto antes de distribuir.
- El wrapper carga primero `src/index.html` (pantalla de conexión) que prueba
  la disponibilidad del servidor con un `fetch(..., {mode:'no-cors'})` antes de
  navegar a `DESKTOP_URL`. Si el servidor no responde (offline, URL mal
  configurada, server caído) muestra una pantalla de error con botones
  *Reintentar* y *Salir* en vez del error crudo del webview.
- No hay bridge JS↔Rust personalizado: la app es HTTP puro contra `apps/api`.
  Si en el futuro se necesita acceso offline, filesystem o hardware nativo,
  agregar comandos en `src-tauri/src/lib.rs` y los permisos correspondientes
  en `capabilities/default.json`.
