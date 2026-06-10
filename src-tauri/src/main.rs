// Prevents an additional console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{
    menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder},
    Emitter,
};

#[tauri::command]
fn noetica_desktop_status() -> serde_json::Value {
    serde_json::json!({
        "kind": "NoeticaDesktopStatus",
        "status": "ok",
        "shell": "tauri",
        "phase": "phase-2-menus-settings-palette"
    })
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let h = app.handle();

            let noetica_submenu = SubmenuBuilder::new(h, "Noetica")
                .item(&PredefinedMenuItem::about(h, None, None)?)
                .separator()
                .item(
                    &MenuItemBuilder::with_id("settings", "Settings\u{2026}")
                        .accelerator("CmdOrCtrl+,")
                        .build(h)?,
                )
                .separator()
                .item(&PredefinedMenuItem::hide(h, None)?)
                .item(&PredefinedMenuItem::hide_others(h, None)?)
                .item(&PredefinedMenuItem::show_all(h, None)?)
                .separator()
                .item(&PredefinedMenuItem::quit(h, None)?)
                .build()?;

            let file_submenu = SubmenuBuilder::new(h, "File")
                .item(
                    &MenuItemBuilder::with_id("new_chat", "New Chat")
                        .accelerator("CmdOrCtrl+N")
                        .build(h)?,
                )
                .item(
                    &MenuItemBuilder::with_id("new_workspace", "New Workspace")
                        .accelerator("CmdOrCtrl+Shift+N")
                        .build(h)?,
                )
                .build()?;

            let edit_submenu = SubmenuBuilder::new(h, "Edit")
                .item(&PredefinedMenuItem::undo(h, None)?)
                .item(&PredefinedMenuItem::redo(h, None)?)
                .separator()
                .item(&PredefinedMenuItem::cut(h, None)?)
                .item(&PredefinedMenuItem::copy(h, None)?)
                .item(&PredefinedMenuItem::paste(h, None)?)
                .separator()
                .item(&PredefinedMenuItem::select_all(h, None)?)
                .build()?;

            let view_submenu = SubmenuBuilder::new(h, "View")
                .item(
                    &MenuItemBuilder::with_id("toggle_sidebar", "Toggle Sidebar")
                        .accelerator("CmdOrCtrl+Backslash")
                        .build(h)?,
                )
                .item(
                    &MenuItemBuilder::with_id("toggle_inspector", "Toggle Inspector")
                        .accelerator("CmdOrCtrl+I")
                        .build(h)?,
                )
                .item(
                    &MenuItemBuilder::with_id("command_palette", "Command Palette\u{2026}")
                        .accelerator("CmdOrCtrl+K")
                        .build(h)?,
                )
                .separator()
                .item(&PredefinedMenuItem::fullscreen(h, None)?)
                .build()?;

            let window_submenu = SubmenuBuilder::new(h, "Window")
                .item(&PredefinedMenuItem::minimize(h, None)?)
                .item(&PredefinedMenuItem::maximize(h, None)?)
                .separator()
                .item(&PredefinedMenuItem::close_window(h, None)?)
                .build()?;

            let help_submenu = SubmenuBuilder::new(h, "Help")
                .item(
                    &MenuItemBuilder::with_id("open_docs", "Noetica Documentation")
                        .build(h)?,
                )
                .build()?;

            let menu = MenuBuilder::new(h)
                .item(&noetica_submenu)
                .item(&file_submenu)
                .item(&edit_submenu)
                .item(&view_submenu)
                .item(&window_submenu)
                .item(&help_submenu)
                .build()?;

            app.set_menu(menu)?;

            app.on_menu_event(|app_handle, event| {
                let _ = app_handle.emit("noetica:menu", event.id().as_ref());
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![noetica_desktop_status])
        .run(tauri::generate_context!())
        .expect("error while running Noetica desktop shell");
}
