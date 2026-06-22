use std::path::PathBuf;

use tauri::{
    menu::{AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu},
    Manager, WebviewUrl, WebviewWindowBuilder,
};
use url::Url;

const DEFAULT_URL: &str = "http://localhost:4321";
const KIOSK_PATH: &str = "/kiosk";

// Build-time baked configuration. When producing a distributable .msi the
// builder sets these (via scripts/build-dist.mjs); option_env! captures them
// at compile time so installed clients work with no .env present on the
// machine. Runtime env / .env still takes priority, so dev and IT overrides
// keep working. build.rs emits rerun-if-env-changed for all three.
const BAKED_URL: Option<&str> = option_env!("PAYROLL_DESKTOP_URL");
const BAKED_ENABLED: Option<&str> = option_env!("PAYROLL_DESKTOP_ENABLED");
const BAKED_MODE: Option<&str> = option_env!("PAYROLL_DESKTOP_MODE");

/// Per-user override file for distributed installs: lets IT repoint a build
/// without recompiling. Windows-only for v1 (`%APPDATA%\RCG SOFTRIX\.env`).
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

    // 1. Per-user override (distributed installs).
    if let Some(path) = config_override_path() {
        let _ = dotenvy::from_path(&path);
    }

    // 2. Next to the executable (distributed installs).
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let _ = dotenvy::from_path(dir.join(".env"));
        }
    }

    // 3. Walk up from the CWD looking for the first .env (dev monorepo). The
    // shell is usually launched from the repo root, but `tauri dev` runs it
    // from apps/desktop/src-tauri, so we walk upwards.
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

fn resolve_target_url() -> Result<Url, String> {
    let raw = runtime_or_baked("DESKTOP_URL", BAKED_URL).unwrap_or_else(|| DEFAULT_URL.to_string());
    let raw = raw.trim();
    if raw.is_empty() {
        return Err("DESKTOP_URL is set but empty".into());
    }
    let mut url =
        Url::parse(raw).map_err(|e| format!("DESKTOP_URL is not a valid URL ({raw}): {e}"))?;

    // In kiosk mode the shell points the WebView straight at the
    // facial-recognition kiosk page so the device boots into the marcacion UI.
    if is_kiosk_mode() {
        url.set_path(KIOSK_PATH);
    }

    Ok(url)
}

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

    let target = match resolve_target_url() {
        Ok(u) => u,
        Err(e) => {
            eprintln!("[payroll-desktop] {e}");
            std::process::exit(1);
        }
    };

    eprintln!("[payroll-desktop] target: {target}");

    let target_str = target.to_string();
    let target_for_menu = target_str.clone();
    let kiosk = is_kiosk_mode();

    tauri::Builder::default()
        .setup(move |app| {
            let menu = build_menu(app.handle())?;
            app.set_menu(menu)?;

            // Inject the target URL into the boot page so it can probe the
            // server reachability before navigating away. Runs on every page
            // load; only the boot page reads window.__PAYROLL_TARGET__.
            let init_script = format!(
                "window.__PAYROLL_TARGET__ = {};",
                serde_json::to_string(&target_str).unwrap_or_else(|_| "\"\"".into())
            );

            let window =
                WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                    .title("RCG SOFTRIX")
                    .inner_size(1280.0, 800.0)
                    .min_inner_size(1024.0, 640.0)
                    .resizable(true)
                    .fullscreen(kiosk)
                    .visible(false)
                    .initialization_script(&init_script)
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
                if let Some(win) = app.get_webview_window("main") {
                    let js = format!(
                        "location.replace({})",
                        serde_json::to_string(&target_for_menu).unwrap_or_else(|_| "''".into())
                    );
                    let _ = win.eval(&js);
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
