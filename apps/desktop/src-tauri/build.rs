fn main() {
    // option_env! in lib.rs captures these at compile time. Without these
    // hints cargo could serve a cached binary with a stale baked value when
    // the build-dist URL/mode changes.
    println!("cargo:rerun-if-env-changed=PAYROLL_DESKTOP_URL");
    println!("cargo:rerun-if-env-changed=PAYROLL_DESKTOP_ENABLED");
    println!("cargo:rerun-if-env-changed=PAYROLL_DESKTOP_MODE");
    tauri_build::build()
}
