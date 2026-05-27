# @payroll/desktop

Tauri 2 desktop shell para PayrollSoft. Es un wrapper delgado: abre una
ventana nativa que carga la URL del web app (`apps/web`). La app web sigue
disponible desde el navegador; el escritorio es un canal adicional.

## Cómo se activa

Se controla con dos variables en el `.env` de la raíz del monorepo:

| Variable | Descripción |
|----------|-------------|
| `DESKTOP_ENABLED` | Gate de arranque. Sólo si es `true`/`1`/`yes`/`on` la ventana se abre. Con cualquier otro valor el binario imprime un aviso y sale. |
| `DESKTOP_URL` | URL que carga la ventana. Por defecto `http://localhost:4321`. En producción apuntar al host público. |

Estas variables se leen al arrancar el binario, no en build, así que el
mismo `.dmg` / `.msi` / `.AppImage` se puede repuntar cambiando el `.env`.

## Desarrollo

Requisitos: Rust toolchain (`cargo` ≥ 1.77) y las dependencias nativas de
Tauri para tu plataforma (ver [tauri.app/start/prerequisites](https://tauri.app/start/prerequisites/)).

```bash
# 1. Levanta el web app en otra terminal
bun --filter @payroll/web dev

# 2. En el .env de la raíz
DESKTOP_ENABLED=true
DESKTOP_URL=http://localhost:4321

# 3. Lanza la ventana
bun --filter @payroll/desktop dev
```

## Build

```bash
bun --filter @payroll/desktop build
```

Los instaladores quedan en `apps/desktop/src-tauri/target/release/bundle/`.

## Notas

- Los iconos en `src-tauri/icons/` son placeholders de color sólido.
  Reemplazarlos por arte real antes de distribuir builds.
- El wrapper no incluye bridge JS-Rust personalizado: la app es HTTP pura
  contra `apps/api`. Si en el futuro se necesita acceso offline o
  filesystem nativo, agregar comandos en `src-tauri/src/lib.rs` y los
  permisos correspondientes en `capabilities/default.json`.
