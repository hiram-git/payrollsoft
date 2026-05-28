use std::path::PathBuf;

use tauri::{
    menu::{AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu},
    Manager, WebviewUrl, WebviewWindowBuilder,
};
use url::Url;

const DEFAULT_URL: &str = "http://localhost:4321";

fn load_env() {
    // Walk up from the binary's CWD looking for the first .env. The desktop
    // shell is usually launched from the monorepo root (where the shared .env
    // lives) but `tauri dev` runs it from apps/desktop/src-tauri, so we walk
    // upwards and load the first match.
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

fn resolve_target_url() -> Result<Url, String> {
    let raw = std::env::var("DESKTOP_URL").unwrap_or_else(|_| DEFAULT_URL.to_string());
    let raw = raw.trim();
    if raw.is_empty() {
        return Err("DESKTOP_URL is set but empty".into());
    }
    Url::parse(raw).map_err(|e| format!("DESKTOP_URL is not a valid URL ({raw}): {e}"))
}

fn build_menu(app: &tauri::AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let about = AboutMetadata {
        name: Some("PayrollSoft".into()),
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
            Some("Acerca de PayrollSoft"),
            Some(about),
        )?],
    )?;

    Menu::with_items(app, &[&file, &edit, &view, &help])
}

pub fn run() {
    load_env();

    let enabled = std::env::var("DESKTOP_ENABLED")
        .map(|v| is_truthy(&v))
        .unwrap_or(false);

    if !enabled {
        eprintln!(
            "[payroll-desktop] DESKTOP_ENABLED is not truthy — refusing to launch.\n\
             Set DESKTOP_ENABLED=true in your .env to run the desktop shell."
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
                    .title("PayrollSoft")
                    .inner_size(1280.0, 800.0)
                    .min_inner_size(1024.0, 640.0)
                    .resizable(true)
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
