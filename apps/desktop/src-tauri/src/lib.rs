use std::path::PathBuf;

use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use url::Url;

const DEFAULT_URL: &str = "http://localhost:4321";

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
    Url::parse(raw).map_err(|e| format!("DESKTOP_URL is not a valid URL ({raw}): {e}"))
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

    tauri::Builder::default()
        .setup(move |app| {
            let webview_url = WebviewUrl::External(target.clone());
            let window = WebviewWindowBuilder::new(app, "main", webview_url)
                .title("PayrollSoft")
                .inner_size(1280.0, 800.0)
                .min_inner_size(1024.0, 640.0)
                .resizable(true)
                .visible(false)
                .build()?;
            window.show()?;
            let _ = app.get_webview_window("main");
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
