// Prevents an additional console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[tauri::command]
fn noetica_desktop_status() -> serde_json::Value {
    serde_json::json!({
        "kind": "NoeticaDesktopStatus",
        "status": "ok",
        "shell": "tauri",
        "phase": "phase-1h-tauri-shell"
    })
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![noetica_desktop_status])
        .run(tauri::generate_context!())
        .expect("error while running Noetica desktop shell");
}
