use std::path::PathBuf;

use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use url::Url;

const DEFAULT_URL: &str = "http://localhost:4321";
const KIOSK_PATH: &str = "/kiosk";

fn load_env() {
    // Look for a .env up the tree starting from the binary's CWD. The desktop
    // shell is usually launched from the monorepo root (where the shared .env
    // lives) but `tauri dev` runs it from apps/desktop/src-tauri, so we walk
    // upwards and load the first .env we find.
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
    let mut url = Url::parse(raw).map_err(|e| format!("DESKTOP_URL is not a valid URL ({raw}): {e}"))?;

    // When DESKTOP_MODE=kiosk the shell points the WebView at the
    // facial-recognition kiosk page so the device boots straight into the
    // marcacion UI. Operators can still navigate elsewhere via the URL
    // unless they pin the windows to fullscreen + lock down keys.
    let mode = std::env::var("DESKTOP_MODE").unwrap_or_default();
    if mode.trim().eq_ignore_ascii_case("kiosk") {
        url.set_path(KIOSK_PATH);
    }

    Ok(url)
}

fn is_kiosk_mode() -> bool {
    std::env::var("DESKTOP_MODE")
        .map(|v| v.trim().eq_ignore_ascii_case("kiosk"))
        .unwrap_or(false)
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

    eprintln!("[payroll-desktop] loading {target}");

    let kiosk = is_kiosk_mode();

    tauri::Builder::default()
        .setup(move |app| {
            let webview_url = WebviewUrl::External(target.clone());
            let mut builder = WebviewWindowBuilder::new(app, "main", webview_url)
                .title(if kiosk { "PayrollSoft — Marcación" } else { "PayrollSoft" })
                .inner_size(1280.0, 800.0)
                .min_inner_size(1024.0, 640.0)
                .resizable(true)
                .visible(false);
            if kiosk {
                builder = builder.fullscreen(true).resizable(false);
            }
            let window = builder.build()?;
            window.show()?;
            let _ = app.get_webview_window("main");
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
