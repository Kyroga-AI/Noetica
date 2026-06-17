// Prevents an additional console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use std::sync::Mutex;
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder},
    Emitter, Manager,
};
use tauri_plugin_global_shortcut::{Code, Modifiers, Shortcut, ShortcutState};
use tauri_plugin_shell::ShellExt;

/// Holds the port the Agent Machine sidecar is listening on.
/// None means the sidecar failed to start (dev mode without binary, or error).
struct AgentMachineState {
    port: Option<u16>,
}

#[tauri::command]
fn noetica_desktop_status() -> serde_json::Value {
    serde_json::json!({
        "kind": "NoeticaDesktopStatus",
        "status": "ok",
        "shell": "tauri",
        "phase": "phase-3-agent-machine-code-execution"
    })
}

/// Returns the Agent Machine base URL if the sidecar started successfully.
/// The frontend uses this to auto-configure the agentMachineEndpoint setting.
#[tauri::command]
fn get_agent_machine_url(state: tauri::State<Mutex<AgentMachineState>>) -> Option<String> {
    let s = state.lock().ok()?;
    s.port.map(|p| format!("http://127.0.0.1:{}", p))
}

/// Speak text using macOS `say` command — much better quality than Web Speech API.
/// Spawns non-blocking so the UI doesn't freeze. Pass voice="" for system default.
#[tauri::command]
fn speak_text(text: String, voice: String) {
    let mut cmd = std::process::Command::new("say");
    if !voice.is_empty() {
        cmd.arg("-v").arg(&voice);
    }
    cmd.arg(&text);
    let _ = cmd.spawn();
}

/// Stop any in-progress `say` process.
#[tauri::command]
fn stop_speaking() {
    let _ = std::process::Command::new("killall").arg("say").spawn();
}

/// Probes port 8080 via TCP — works whether AM started as a sidecar or manually.
/// Called from the frontend settings context; bypasses WKWebView ATS restrictions.
#[tauri::command]
fn probe_agent_machine() -> Option<String> {
    use std::net::TcpStream;
    use std::time::Duration;
    if TcpStream::connect_timeout(
        &"127.0.0.1:8080".parse().unwrap(),
        Duration::from_millis(500),
    ).is_ok() {
        Some("http://127.0.0.1:8080".to_string())
    } else {
        None
    }
}

/// Captures the full screen and returns a base64-encoded PNG.
/// Uses `screencapture` on macOS, `scrot` on Linux.
/// Returns an error string if the capture fails (e.g., no screen-recording permission).
#[tauri::command]
async fn take_screenshot() -> Result<String, String> {
    let tmp = std::env::temp_dir().join(format!("noetica_sc_{}.png", std::process::id()));
    let path = tmp.to_str().ok_or("bad tmp path")?;

    #[cfg(target_os = "macos")]
    let status = std::process::Command::new("screencapture")
        .args(["-x", "-t", "png", path])
        .status()
        .map_err(|e| format!("screencapture: {}", e))?;

    #[cfg(target_os = "linux")]
    let status = std::process::Command::new("scrot")
        .arg(path)
        .status()
        .map_err(|e| format!("scrot: {}", e))?;

    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    return Err("Screenshots not supported on this platform".into());

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    if !status.success() {
        return Err("Screenshot capture failed — check Screen Recording permissions in System Settings.".into());
    }

    let bytes = std::fs::read(&tmp).map_err(|e| e.to_string())?;
    let _ = std::fs::remove_file(&tmp);
    Ok(B64.encode(&bytes))
}

#[derive(serde::Deserialize)]
struct DragPoint { x: i32, y: i32 }

#[derive(serde::Deserialize)]
struct ComputerAction {
    action_type: String,
    x: Option<i32>,
    y: Option<i32>,
    text: Option<String>,
    key: Option<String>,
    scroll_x: Option<i32>,
    scroll_y: Option<i32>,
    drag_path: Option<Vec<DragPoint>>,
}

/// Executes a computer use action (mouse/keyboard) via osascript on macOS.
/// Every action is gated behind user confirmation on the frontend — this just executes it.
#[tauri::command]
async fn execute_computer_action(action: ComputerAction) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let script = match action.action_type.as_str() {
            "mouse_move" => {
                let x = action.x.ok_or("x required")?;
                let y = action.y.ok_or("y required")?;
                format!(
                    "tell application \"System Events\" to set the mouse position to {{{}, {}}}",
                    x, y
                )
            }
            "left_click" | "right_click" | "double_click" => {
                let x = action.x.ok_or("x required")?;
                let y = action.y.ok_or("y required")?;
                let button = if action.action_type == "right_click" { "right" } else { "left" };
                let clicks = if action.action_type == "double_click" { 2 } else { 1 };
                format!(
                    "tell application \"System Events\" to click {} mouse at {{{}, {}}} with {} click{}",
                    button, x, y, clicks, if clicks == 1 { "" } else { "s" }
                )
            }
            "type" => {
                let text = action.text.as_deref().unwrap_or("");
                let escaped = text.replace('\\', "\\\\").replace('"', "\\\"");
                format!(
                    "tell application \"System Events\" to keystroke \"{}\"",
                    escaped
                )
            }
            "key" => {
                let key = action.key.as_deref().unwrap_or("Return");
                // Map common key names to AppleScript key codes / keystroke combos
                let script = match key {
                    "Return" | "Enter" => "tell application \"System Events\" to key code 36".into(),
                    "Tab" => "tell application \"System Events\" to key code 48".into(),
                    "Escape" => "tell application \"System Events\" to key code 53".into(),
                    "BackSpace" | "Delete" => "tell application \"System Events\" to key code 51".into(),
                    "ctrl+a" => "tell application \"System Events\" to keystroke \"a\" using {control down}".into(),
                    "ctrl+c" => "tell application \"System Events\" to keystroke \"c\" using {control down}".into(),
                    "ctrl+v" => "tell application \"System Events\" to keystroke \"v\" using {control down}".into(),
                    "super+a" | "cmd+a" => "tell application \"System Events\" to keystroke \"a\" using {command down}".into(),
                    "super+c" | "cmd+c" => "tell application \"System Events\" to keystroke \"c\" using {command down}".into(),
                    "super+v" | "cmd+v" => "tell application \"System Events\" to keystroke \"v\" using {command down}".into(),
                    _ => format!("tell application \"System Events\" to keystroke \"{}\"", key),
                };
                script
            }
            "scroll" => {
                let x = action.x.unwrap_or(0);
                let y_coord = action.y.unwrap_or(0);
                let direction = if action.scroll_y.unwrap_or(1) >= 0 { "down" } else { "up" };
                format!(
                    "tell application \"System Events\" to scroll {} at {{{}, {}}}",
                    direction, x, y_coord
                )
            }
            "drag" => {
                let pts = action.drag_path.as_deref().unwrap_or(&[]);
                if pts.len() < 2 { return Ok(()) }
                // Use JXA (JavaScript for Automation) which has real CGEvent mouse button support
                let mut moves = String::new();
                for (i, pt) in pts.iter().enumerate() {
                    moves.push_str(&format!(
                        "var d{i} = $.CGEventCreateMouseEvent(null, $.kCGEventLeftMouseDragged, $.CGPointMake({x}, {y}), $.kCGMouseButtonLeft); $.CGEventPost($.kCGHIDEventTap, d{i}); $.usleep(8000);\n",
                        i = i, x = pt.x, y = pt.y
                    ));
                }
                let start = &pts[0];
                let end   = &pts[pts.len() - 1];
                let script = format!(
                    "ObjC.import('CoreGraphics'); \
                     var down = $.CGEventCreateMouseEvent(null, $.kCGEventLeftMouseDown, $.CGPointMake({sx}, {sy}), $.kCGMouseButtonLeft); \
                     $.CGEventPost($.kCGHIDEventTap, down); \
                     $.usleep(50000); \
                     {moves}\
                     var up = $.CGEventCreateMouseEvent(null, $.kCGEventLeftMouseUp, $.CGPointMake({ex}, {ey}), $.kCGMouseButtonLeft); \
                     $.CGEventPost($.kCGHIDEventTap, up);",
                    sx = start.x, sy = start.y,
                    moves = moves,
                    ex = end.x, ey = end.y
                );
                // Run as JXA, not AppleScript
                let status = std::process::Command::new("osascript")
                    .arg("-l").arg("JavaScript")
                    .arg("-e").arg(&script)
                    .status()
                    .map_err(|e| format!("osascript JXA: {}", e))?;
                if !status.success() {
                    return Err("Drag failed — check Accessibility permissions.".into());
                }
                std::thread::sleep(std::time::Duration::from_millis(300));
                return Ok(());
            }
            "wait" => {
                "delay 0.5".into()
            }
            "screenshot" => return Ok(()), // handled separately via take_screenshot
            other => return Err(format!("unknown action type: {}", other)),
        };

        let status = std::process::Command::new("osascript")
            .arg("-e")
            .arg(&script)
            .status()
            .map_err(|e| format!("osascript: {}", e))?;

        if !status.success() {
            return Err("Action execution failed — check Accessibility permissions in System Settings.".into());
        }

        // Small pause after action so screen settles before next screenshot
        std::thread::sleep(std::time::Duration::from_millis(300));
        Ok(())
    }

    #[cfg(not(target_os = "macos"))]
    Err("Computer actions only supported on macOS currently.".into())
}

// ─── File system commands ─────────────────────────────────────────────────────

/// Read a local file as UTF-8 text (≤ 2MB). Used by the filesystem tool.
#[tauri::command]
async fn read_local_file(path: String) -> Result<String, String> {
    let p = std::path::Path::new(&path);
    if !p.exists() { return Err(format!("File not found: {}", path)) }
    let meta = std::fs::metadata(p).map_err(|e| e.to_string())?;
    if meta.len() > 2 * 1024 * 1024 {
        return Err(format!("File too large ({} bytes). Max 2 MB.", meta.len()))
    }
    std::fs::read_to_string(p).map_err(|e| e.to_string())
}

/// List files and directories at the given path (non-recursive).
#[tauri::command]
async fn list_directory(path: String) -> Result<Vec<serde_json::Value>, String> {
    let p = std::path::Path::new(&path);
    if !p.is_dir() { return Err(format!("Not a directory: {}", path)) }
    let mut entries = Vec::new();
    for entry in std::fs::read_dir(p).map_err(|e| e.to_string())? {
        let e = entry.map_err(|e| e.to_string())?;
        let meta = e.metadata().ok();
        let is_dir = meta.as_ref().map(|m| m.is_dir()).unwrap_or(false);
        let size   = meta.as_ref().map(|m| m.len()).unwrap_or(0);
        entries.push(serde_json::json!({
            "name": e.file_name().to_string_lossy(),
            "path": e.path().to_string_lossy(),
            "is_dir": is_dir,
            "size_bytes": size,
        }))
    }
    entries.sort_by(|a, b| {
        let a_dir = a["is_dir"].as_bool().unwrap_or(false);
        let b_dir = b["is_dir"].as_bool().unwrap_or(false);
        b_dir.cmp(&a_dir).then_with(|| a["name"].as_str().unwrap_or("").cmp(b["name"].as_str().unwrap_or("")))
    });
    Ok(entries)
}

/// Write text content to a local file. Creates parent directories if needed.
#[tauri::command]
async fn write_local_file(path: String, content: String) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(p, content).map_err(|e| e.to_string())
}

fn main() {
    // Cmd+Shift+Space — summon/hide Noetica from anywhere on the system
    let global_shortcut = Shortcut::new(
        Some(Modifiers::SUPER | Modifiers::SHIFT),
        Code::Space,
    );

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_shortcut(global_shortcut)
                .expect("invalid shortcut")
                .with_handler(|app, shortcut, event| {
                    if event.state() != ShortcutState::Pressed { return }
                    let _ = shortcut; // suppress unused warning
                    if let Some(win) = app.get_webview_window("main") {
                        let focused = win.is_focused().unwrap_or(false);
                        let visible = win.is_visible().unwrap_or(true);
                        if focused || !visible {
                            if visible {
                                let _ = win.hide();
                            } else {
                                let _ = win.show();
                                let _ = win.set_focus();
                            }
                        } else {
                            let _ = win.set_focus();
                        }
                    }
                })
                .build(),
        )
        .manage(Mutex::new(AgentMachineState { port: None }))
        .setup(|app| {
            let h = app.handle();

            // ── Ollama sidecar ────────────────────────────────────────────────
            // Start bundled Ollama before the Agent Machine so local models
            // are available when AM's first request arrives.
            match h.shell().sidecar("ollama") {
                Ok(cmd) => {
                    match cmd.args(["serve"]).spawn() {
                        Ok((mut rx, _child)) => {
                            let _ = h.emit("noetica:ollama:started", serde_json::json!({
                                "host": "http://127.0.0.1:11434"
                            }));
                            tauri::async_runtime::spawn(async move {
                                use tauri_plugin_shell::process::CommandEvent;
                                while let Some(event) = rx.recv().await {
                                    match event {
                                        CommandEvent::Stderr(line) => {
                                            eprintln!("[noetica-ollama] {}", String::from_utf8_lossy(&line));
                                        }
                                        CommandEvent::Terminated(status) => {
                                            eprintln!("[noetica-ollama] terminated: {:?}", status);
                                            break;
                                        }
                                        _ => {}
                                    }
                                }
                            });
                        }
                        Err(e) => {
                            // Expected in dev when no binary — system Ollama will be used if running
                            eprintln!("[noetica-ollama] sidecar not found (using system Ollama if available): {}", e);
                        }
                    }
                }
                Err(e) => {
                    eprintln!("[noetica-ollama] sidecar not configured: {}", e);
                }
            }

            // ── Agent Machine sidecar ──────────────────────────────────────────
            // Attempt to start the bundled agent-machine binary.
            // In dev mode (no binary present), this fails silently — users can
            // start the AM manually with `npm run agent-machine`.
            let am_port: u16 = std::env::var("NOETICA_AM_PORT")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(8080);

            match h.shell().sidecar("agent-machine") {
                Ok(cmd) => {
                    match cmd
                        .env("NOETICA_AM_PORT", am_port.to_string())
                        .spawn()
                    {
                        Ok((mut rx, _child)) => {
                            if let Ok(mut state) = app.state::<Mutex<AgentMachineState>>().lock() {
                                state.port = Some(am_port);
                            }

                            let app_handle = h.clone();
                            tauri::async_runtime::spawn(async move {
                                use tauri_plugin_shell::process::CommandEvent;
                                while let Some(event) = rx.recv().await {
                                    match event {
                                        CommandEvent::Stdout(line) => {
                                            eprintln!("[noetica-am] {}", String::from_utf8_lossy(&line));
                                        }
                                        CommandEvent::Stderr(line) => {
                                            eprintln!("[noetica-am:err] {}", String::from_utf8_lossy(&line));
                                        }
                                        CommandEvent::Error(e) => {
                                            eprintln!("[noetica-am] process error: {}", e);
                                        }
                                        CommandEvent::Terminated(status) => {
                                            eprintln!("[noetica-am] terminated: {:?}", status);
                                            let _ = app_handle.emit("noetica:am:stopped", ());
                                            break;
                                        }
                                        _ => {}
                                    }
                                }
                            });

                            let _ = h.emit("noetica:am:started", serde_json::json!({
                                "port": am_port,
                                "url": format!("http://127.0.0.1:{}", am_port)
                            }));
                        }
                        Err(e) => {
                            eprintln!("[noetica-am] sidecar spawn failed (dev mode?): {}", e);
                        }
                    }
                }
                Err(e) => {
                    eprintln!("[noetica-am] sidecar not found (build agent-machine first): {}", e);
                }
            }

            // ── App menu ───────────────────────────────────────────────────────
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
        .invoke_handler(tauri::generate_handler![
            noetica_desktop_status,
            get_agent_machine_url,
            probe_agent_machine,
            speak_text,
            stop_speaking,
            take_screenshot,
            execute_computer_action,
            read_local_file,
            list_directory,
            write_local_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Noetica desktop shell");
}
