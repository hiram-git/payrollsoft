use std::path::PathBuf;

use tauri::{
    menu::{AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu},
    Manager, WebviewUrl, WebviewWindowBuilder,
};
use url::Url;

const KIOSK_PATH: &str = "/kiosk";

// Build-time baked configuration. When producing a distributable .msi the
// builder sets these (via scripts/build-dist.mjs); option_env! captures them
// at compile time so installed clients work with no .env present on the
// machine. Runtime env / .env still takes priority, so dev and IT overrides
// keep working. build.rs emits rerun-if-env-changed for all three.
const BAKED_URL: Option<&str> = option_env!("PAYROLL_DESKTOP_URL");
const BAKED_ENABLED: Option<&str> = option_env!("PAYROLL_DESKTOP_ENABLED");
const BAKED_MODE: Option<&str> = option_env!("PAYROLL_DESKTOP_MODE");

/// Per-user override file for distributed installs: lets IT — or the in-app
/// "Cambiar servidor" dialog — repoint a build without recompiling.
/// Windows-only for v1 (`%APPDATA%\RCG SOFTRIX\.env`).
fn config_override_path() -> Option<PathBuf> {
    std::env::var("APPDATA")
        .ok()
        .map(|appdata| PathBuf::from(appdata).join("RCG SOFTRIX").join(".env"))
}

fn load_env() {
    // dotenvy::from_path never overrides vars already in the process env, so we
    // load from most- to least-specific and the first wins. These locations are
    // mutually exclusive in practice: distributed installs use the override
    // file / exe dir, the dev monorepo uses the CWD walk.

    if let Some(path) = config_override_path() {
        let _ = dotenvy::from_path(&path);
    }

    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let _ = dotenvy::from_path(dir.join(".env"));
        }
    }

    let mut cursor: PathBuf = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    loop {
        let candidate = cursor.join(".env");
        if candidate.is_file() {
            let _ = dotenvy::from_path(&candidate);
            break;
        }
        if !cursor.pop() {
            break;
        }
    }
}

fn is_truthy(raw: &str) -> bool {
    matches!(
        raw.trim().to_ascii_lowercase().as_str(),
        "1" | "true" | "yes" | "on"
    )
}

/// Runtime env var (incl. values loaded from a .env) wins; otherwise fall back
/// to the value baked at build time.
fn runtime_or_baked(var: &str, baked: Option<&str>) -> Option<String> {
    std::env::var(var)
        .ok()
        .or_else(|| baked.map(|s| s.to_string()))
}

fn resolve_mode() -> String {
    runtime_or_baked("DESKTOP_MODE", BAKED_MODE).unwrap_or_default()
}

fn is_kiosk_mode() -> bool {
    resolve_mode().trim().eq_ignore_ascii_case("kiosk")
}

/// Resolved target URL or None when nothing is configured yet. None lets the
/// boot screen show its first-run config form instead of refusing to launch.
fn resolve_target_url() -> Option<Url> {
    let raw = runtime_or_baked("DESKTOP_URL", BAKED_URL)?;
    let raw = raw.trim();
    if raw.is_empty() {
        return None;
    }
    let mut url = Url::parse(raw).ok()?;
    if is_kiosk_mode() {
        url.set_path(KIOSK_PATH);
    }
    Some(url)
}

// ─── Tauri commands ────────────────────────────────────────────────────────
// Invoked from src/index.html via window.__TAURI_INTERNALS__.invoke.

#[tauri::command]
fn current_url() -> String {
    resolve_target_url()
        .map(|u| u.to_string())
        .unwrap_or_default()
}

#[tauri::command]
fn save_desktop_url(url: String) -> Result<(), String> {
    let trimmed = url.trim();
    let parsed = Url::parse(trimmed).map_err(|e| format!("URL inválida: {e}"))?;

    let dir = config_override_path()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()))
        .ok_or_else(|| "No se pudo resolver %APPDATA% (¿estás en Windows?)".to_string())?;
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("No se pudo crear el directorio de configuración: {e}"))?;
    let path = dir.join(".env");

    // Preserve any other keys the operator may have placed in the override
    // .env (DESKTOP_MODE, DESKTOP_ENABLED, etc.) — only DESKTOP_URL is rewritten.
    let existing = std::fs::read_to_string(&path).unwrap_or_default();
    let mut lines: Vec<String> = Vec::new();
    let mut updated = false;
    for line in existing.lines() {
        if line.trim_start().starts_with("DESKTOP_URL=") {
            lines.push(format!("DESKTOP_URL={}", parsed.as_str()));
            updated = true;
        } else {
            lines.push(line.to_string());
        }
    }
    if !updated {
        lines.push(format!("DESKTOP_URL={}", parsed.as_str()));
    }
    let body = format!("{}\n", lines.join("\n"));
    std::fs::write(&path, body).map_err(|e| format!("No se pudo escribir el archivo .env: {e}"))?;

    // Reflect in the process env so current_url() and the menu's "Ir al inicio"
    // pick up the new value without restarting the app.
    std::env::set_var("DESKTOP_URL", parsed.as_str());
    Ok(())
}

#[tauri::command]
fn apply_url(app: tauri::AppHandle, url: String) -> Result<(), String> {
    let parsed: Url = url
        .trim()
        .parse()
        .map_err(|e: url::ParseError| format!("URL inválida: {e}"))?;
    let main = app
        .get_webview_window("main")
        .ok_or_else(|| "Ventana principal no disponible".to_string())?;
    main.navigate(parsed)
        .map_err(|e| format!("Error al navegar: {e}"))?;
    Ok(())
}

#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

#[tauri::command]
fn close_config_window(app: tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("config") {
        let _ = w.close();
    }
}

// ─── Menu ──────────────────────────────────────────────────────────────────

fn build_menu(app: &tauri::AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let about = AboutMetadata {
        name: Some("RCG SOFTRIX".into()),
        version: Some(env!("CARGO_PKG_VERSION").into()),
        ..Default::default()
    };

    let file = Submenu::with_items(
        app,
        "Archivo",
        true,
        &[
            &MenuItem::with_id(
                app,
                "config",
                "Cambiar servidor…",
                true,
                Some("CmdOrCtrl+,"),
            )?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "reload", "Recargar", true, Some("CmdOrCtrl+R"))?,
            &MenuItem::with_id(app, "home", "Ir al inicio", true, Some("CmdOrCtrl+H"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::quit(app, Some("Salir"))?,
        ],
    )?;

    let edit = Submenu::with_items(
        app,
        "Editar",
        true,
        &[
            &PredefinedMenuItem::undo(app, Some("Deshacer"))?,
            &PredefinedMenuItem::redo(app, Some("Rehacer"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, Some("Cortar"))?,
            &PredefinedMenuItem::copy(app, Some("Copiar"))?,
            &PredefinedMenuItem::paste(app, Some("Pegar"))?,
            &PredefinedMenuItem::select_all(app, Some("Seleccionar todo"))?,
        ],
    )?;

    let view = Submenu::with_items(
        app,
        "Ver",
        true,
        &[
            &MenuItem::with_id(app, "toggle_devtools", "DevTools", true, Some("F12"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::fullscreen(app, Some("Pantalla completa"))?,
        ],
    )?;

    let help = Submenu::with_items(
        app,
        "Ayuda",
        true,
        &[&PredefinedMenuItem::about(
            app,
            Some("Acerca de RCG SOFTRIX"),
            Some(about),
        )?],
    )?;

    Menu::with_items(app, &[&file, &edit, &view, &help])
}

pub fn run() {
    load_env();

    let enabled = runtime_or_baked("DESKTOP_ENABLED", BAKED_ENABLED)
        .map(|v| is_truthy(&v))
        .unwrap_or(false);

    if !enabled {
        eprintln!(
            "[payroll-desktop] DESKTOP_ENABLED is not truthy — refusing to launch.\n\
             For dev: set DESKTOP_ENABLED=true in your .env.\n\
             For a distributable build: bake it with `bun --filter @payroll/desktop \
             build:dist -- --url=https://your-cloud-host`."
        );
        std::process::exit(0);
    }

    match resolve_target_url() {
        Some(u) => eprintln!("[payroll-desktop] target: {u}"),
        None => eprintln!("[payroll-desktop] target not configured — boot screen will prompt"),
    }

    let kiosk = is_kiosk_mode();

    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            current_url,
            save_desktop_url,
            apply_url,
            quit_app,
            close_config_window,
        ])
        .setup(move |app| {
            let menu = build_menu(app.handle())?;
            app.set_menu(menu)?;

            let window =
                WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                    .title("RCG SOFTRIX")
                    .inner_size(1280.0, 800.0)
                    .min_inner_size(1024.0, 640.0)
                    .resizable(true)
                    .fullscreen(kiosk)
                    .visible(false)
                    .build()?;

            window.show()?;
            Ok(())
        })
        .on_menu_event(move |app, event| match event.id().as_ref() {
            "reload" => {
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.eval("location.reload()");
                }
            }
            "home" => {
                if let Some(url) = resolve_target_url() {
                    if let Some(win) = app.get_webview_window("main") {
                        let _ = win.navigate(url);
                    }
                }
            }
            "config" => {
                if let Some(existing) = app.get_webview_window("config") {
                    let _ = existing.set_focus();
                } else {
                    let _ = WebviewWindowBuilder::new(
                        app,
                        "config",
                        WebviewUrl::App("index.html?config=1".into()),
                    )
                    .title("Cambiar servidor — RCG SOFTRIX")
                    .inner_size(480.0, 380.0)
                    .min_inner_size(420.0, 340.0)
                    .resizable(false)
                    .build();
                }
            }
            "toggle_devtools" => {
                if let Some(_win) = app.get_webview_window("main") {
                    #[cfg(any(debug_assertions, feature = "devtools"))]
                    {
                        if _win.is_devtools_open() {
                            _win.close_devtools();
                        } else {
                            _win.open_devtools();
                        }
                    }
                }
            }
            _ => {}
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
