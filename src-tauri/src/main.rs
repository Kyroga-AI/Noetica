// Prevents an additional console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, WindowEvent,
};
use tauri_plugin_global_shortcut::{Code, Modifiers, Shortcut, ShortcutState};
use tauri_plugin_shell::ShellExt;

/// Holds the port the Agent Machine sidecar is listening on.
/// None means the sidecar failed to start (dev mode without binary, or error).
struct AgentMachineState {
    port: Option<u16>,
    /// PID of the Agent Machine sidecar, so we can gracefully SIGTERM it on app exit
    /// — its own handler then tears down the managed Ollama (no orphaned `ollama serve`).
    am_pid: Option<u32>,
}

/// Set once the app is genuinely quitting (Cmd+Q / tray Quit / RunEvent::Exit) so the
/// Agent Machine watchdog does NOT resurrect the backend during a deliberate shutdown.
static SHUTTING_DOWN: AtomicBool = AtomicBool::new(false);
/// Cold crash-loop budget. A backend that stays up >60s refreshes this; a hard loop stops.
const MAX_AM_RETRIES: u32 = 5;

/// Spawn the Agent Machine sidecar and watch it. On unexpected termination — most often an
/// OOM kill under heavy local-model load — re-spawn after a short backoff so the app
/// self-heals instead of dead-ending at "Load failed". A process that stayed up past 60s is
/// treated as healthy and refreshes the retry budget; otherwise the budget decrements so a
/// genuine crash-loop eventually gives up rather than thrashing forever.
fn spawn_agent_machine(app_handle: tauri::AppHandle, am_port: u16, retries_left: u32) {
    use tauri_plugin_shell::process::CommandEvent;

    // Dev ergonomics: if an Agent Machine is ALREADY listening on the port (e.g. one you ran
    // from source via `npm run agent-machine` / `npm run dev:app`), reuse it instead of
    // spawning the bundled sidecar — so source changes are live without rebuilding the binary.
    {
        use std::net::TcpStream;
        use std::time::Duration;
        if let Ok(sa) = format!("127.0.0.1:{}", am_port).parse::<std::net::SocketAddr>() {
            if TcpStream::connect_timeout(&sa, Duration::from_millis(400)).is_ok() {
                eprintln!("[noetica-am] reusing Agent Machine already on :{} (skipping bundled sidecar)", am_port);
                if let Ok(mut state) = app_handle.state::<Mutex<AgentMachineState>>().lock() {
                    state.port = Some(am_port);
                    state.am_pid = None; // not our child — don't SIGTERM it on exit
                }
                let _ = app_handle.emit("noetica:am:started", serde_json::json!({
                    "port": am_port, "url": format!("http://127.0.0.1:{}", am_port)
                }));
                return;
            }
        }
    }

    let cmd = match app_handle.shell().sidecar("agent-machine") {
        Ok(c) => c,
        Err(e) => {
            eprintln!("[noetica-am] sidecar not found (build agent-machine first): {}", e);
            return;
        }
    };
    let (mut rx, child) = match cmd
        .env("NOETICA_AM_PORT", am_port.to_string())
        .env("OLLAMA_HOST", "http://127.0.0.1:11435")
        // Our PID, so the sidecar can poll our existence and tear itself (and the managed
        // Ollama) down if we die — even by crash. bun sidecars reparent to launchd, so they
        // can't rely on their own ppid.
        .env("NOETICA_PARENT_PID", std::process::id().to_string())
        .spawn()
    {
        Ok(s) => s,
        Err(e) => {
            eprintln!("[noetica-am] sidecar spawn failed (dev mode?): {}", e);
            return;
        }
    };
    // Keep the PID (dropping the handle does NOT kill the process) so we can SIGTERM it on
    // app exit and reap the Ollama it owns.
    let am_pid = child.pid();
    if let Ok(mut state) = app_handle.state::<Mutex<AgentMachineState>>().lock() {
        state.port = Some(am_port);
        state.am_pid = Some(am_pid);
    }
    let _ = app_handle.emit("noetica:am:started", serde_json::json!({
        "port": am_port,
        "url": format!("http://127.0.0.1:{}", am_port)
    }));
    let started_at = Instant::now();
    tauri::async_runtime::spawn(async move {
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
                    if !SHUTTING_DOWN.load(Ordering::SeqCst) {
                        let healthy = started_at.elapsed().as_secs() > 60;
                        let next = if healthy { MAX_AM_RETRIES } else { retries_left.saturating_sub(1) };
                        if next > 0 {
                            let ah = app_handle.clone();
                            std::thread::spawn(move || {
                                std::thread::sleep(Duration::from_secs(2));
                                if SHUTTING_DOWN.load(Ordering::SeqCst) { return; }
                                eprintln!("[noetica-am] watchdog: restarting backend ({} tries left)", next);
                                let _ = ah.emit("noetica:am:restarting", ());
                                spawn_agent_machine(ah, am_port, next);
                            });
                        } else {
                            eprintln!("[noetica-am] watchdog: retry budget exhausted — not restarting");
                        }
                    }
                    break;
                }
                _ => {}
            }
        }
    });
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

/// Speak text via the OS system voice — macOS `say`, Linux `spd-say`/`espeak-ng`, Windows SAPI.
/// Spawns non-blocking so the UI doesn't freeze. Pass voice="" for system default.
/// (WebSpeech is dead in WKWebView/WebKitGTK, so this is the only no-key TTS in the packaged app.)
#[tauri::command]
fn speak_text(text: String, voice: String) {
    #[cfg(target_os = "macos")]
    {
        let mut cmd = std::process::Command::new("say");
        if !voice.is_empty() { cmd.arg("-v").arg(&voice); }
        cmd.arg(&text);
        let _ = cmd.spawn();
    }
    #[cfg(target_os = "linux")]
    {
        // Prefer speech-dispatcher (spd-say), fall back to espeak-ng.
        let spd = std::process::Command::new("spd-say")
            .args(if voice.is_empty() { vec!["--wait", text.as_str()] } else { vec!["-o", voice.as_str(), "--wait", text.as_str()] })
            .spawn();
        if spd.is_err() {
            let mut cmd = std::process::Command::new("espeak-ng");
            if !voice.is_empty() { cmd.arg("-v").arg(&voice); }
            cmd.arg(&text);
            let _ = cmd.spawn();
        }
    }
    #[cfg(target_os = "windows")]
    {
        let select = if voice.is_empty() { String::new() } else { format!("$s.SelectVoice('{}');", voice.replace('\'', "")) };
        let script = format!("Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; {} $s.Speak([Console]::In.ReadToEnd())", select);
        use std::io::Write;
        if let Ok(mut child) = std::process::Command::new("powershell")
            .args(["-NoProfile", "-Command", &script])
            .stdin(std::process::Stdio::piped()).spawn() {
            if let Some(mut stdin) = child.stdin.take() { let _ = stdin.write_all(text.as_bytes()); }
        }
    }
}

/// OS keychain for secrets (API keys, OAuth tokens) — macOS Keychain / Linux Secret Service / Windows
/// Credential Manager. Keeps credentials out of plaintext localStorage. Errors are returned as strings so
/// the frontend can fall back gracefully (e.g. a headless Linux box with no Secret Service).
const KEYCHAIN_SERVICE: &str = "ai.noetica.secrets";

#[tauri::command]
fn keychain_set(key: String, value: String) -> Result<(), String> {
    keyring::Entry::new(KEYCHAIN_SERVICE, &key)
        .and_then(|e| e.set_password(&value))
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn keychain_get(key: String) -> Result<Option<String>, String> {
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, &key).map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn keychain_delete(key: String) -> Result<(), String> {
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, &key).map_err(|e| e.to_string())?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

/// Stop any in-progress system-voice process.
#[tauri::command]
fn stop_speaking() {
    #[cfg(target_os = "macos")]
    { let _ = std::process::Command::new("killall").arg("say").spawn(); }
    #[cfg(target_os = "linux")]
    { let _ = std::process::Command::new("pkill").args(["-f", "spd-say|espeak"]).spawn(); }
    #[cfg(target_os = "windows")]
    { let _ = std::process::Command::new("taskkill").args(["/F", "/IM", "powershell.exe"]).spawn(); }
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

    #[cfg(target_os = "linux")]
    {
        // Linux: drive mouse/keyboard via xdotool (install: apt install xdotool / pacman -S xdotool)
        let args: Vec<String> = match action.action_type.as_str() {
            "mouse_move" => {
                let x = action.x.ok_or("x required")?;
                let y = action.y.ok_or("y required")?;
                vec!["mousemove".into(), x.to_string(), y.to_string()]
            }
            "left_click" => {
                let x = action.x.ok_or("x required")?;
                let y = action.y.ok_or("y required")?;
                vec!["mousemove".into(), x.to_string(), y.to_string(), "click".into(), "1".into()]
            }
            "right_click" => {
                let x = action.x.ok_or("x required")?;
                let y = action.y.ok_or("y required")?;
                vec!["mousemove".into(), x.to_string(), y.to_string(), "click".into(), "3".into()]
            }
            "double_click" => {
                let x = action.x.ok_or("x required")?;
                let y = action.y.ok_or("y required")?;
                vec!["mousemove".into(), x.to_string(), y.to_string(), "click".into(), "--repeat".into(), "2".into(), "1".into()]
            }
            "type" => {
                let text = action.text.as_deref().unwrap_or("").to_string();
                vec!["type".into(), "--clearmodifiers".into(), text]
            }
            "key" => {
                let key = action.key.as_deref().unwrap_or("Return");
                let xkey = match key {
                    "Return" | "Enter" => "Return",
                    "Tab" => "Tab",
                    "Escape" => "Escape",
                    "BackSpace" | "Delete" => "BackSpace",
                    // ctrl combos are the same on Linux; cmd/super → ctrl on Linux desktops
                    "ctrl+a" | "super+a" | "cmd+a" => "ctrl+a",
                    "ctrl+c" | "super+c" | "cmd+c" => "ctrl+c",
                    "ctrl+v" | "super+v" | "cmd+v" => "ctrl+v",
                    other => other,
                };
                vec!["key".into(), xkey.into()]
            }
            "scroll" => {
                let x = action.x.unwrap_or(0);
                let y_coord = action.y.unwrap_or(0);
                // xdotool: button 4 = scroll up, 5 = scroll down
                let button = if action.scroll_y.unwrap_or(1) >= 0 { "5" } else { "4" };
                vec!["mousemove".into(), x.to_string(), y_coord.to_string(), "click".into(), button.into()]
            }
            "drag" => {
                let pts = action.drag_path.as_deref().unwrap_or(&[]);
                if pts.len() < 2 { return Ok(()) }
                let start = &pts[0];
                let end   = &pts[pts.len() - 1];
                // Move to start, press, move through path, release
                let mut cmd_args = vec![
                    "mousemove".into(), start.x.to_string(), start.y.to_string(),
                    "mousedown".into(), "1".into(),
                ];
                for pt in pts.iter().skip(1) {
                    cmd_args.push("mousemove".into());
                    cmd_args.push(pt.x.to_string());
                    cmd_args.push(pt.y.to_string());
                }
                cmd_args.push("mouseup".into());
                cmd_args.push("1".into());
                let status = std::process::Command::new("xdotool")
                    .args(&cmd_args)
                    .status()
                    .map_err(|_| "xdotool not found — install it: apt install xdotool".to_string())?;
                if !status.success() {
                    return Err("Drag failed — check that xdotool is installed and X11/Wayland is accessible.".into());
                }
                let _ = end; // used via cmd_args above
                std::thread::sleep(std::time::Duration::from_millis(300));
                return Ok(());
            }
            "wait" => {
                std::thread::sleep(std::time::Duration::from_millis(500));
                return Ok(());
            }
            "screenshot" => return Ok(()),
            other => return Err(format!("unknown action type: {}", other)),
        };
        let status = std::process::Command::new("xdotool")
            .args(&args)
            .status()
            .map_err(|_| "xdotool not found — install it: apt install xdotool".to_string())?;
        if !status.success() {
            return Err("Action failed — ensure xdotool is installed and accessibility is enabled.".into());
        }
        std::thread::sleep(std::time::Duration::from_millis(300));
        Ok(())
    }

    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    Err("Computer actions not supported on this platform.".into())
}

// ─── File system commands ─────────────────────────────────────────────────────

/// Confine a caller-supplied path to safe roots and reject sensitive locations.
///
/// The filesystem tool (and the agent behind it) hands us an arbitrary `path`. Without this,
/// a compromised webview or a jailbroken agent could read `~/.ssh/id_rsa` or overwrite
/// `~/.zshrc`. The policy — the app IS a local-first assistant over the user's own files, so
/// we can't lock it to one workspace, but we can:
///   1. resolve symlinks + `..` (canonicalize the target, or its nearest existing ancestor for
///      not-yet-created write targets) so traversal/symlink escapes can't dodge the checks,
///   2. require the resolved path to live under $HOME or the system temp dir (never /etc,
///      /System, another user's home), and
///   3. deny known credential/key stores even inside $HOME.
fn confine_path(path: &str) -> Result<std::path::PathBuf, String> {
    use std::path::{Path, PathBuf};
    let requested = Path::new(path);

    // Resolve to an absolute, symlink-free path. Reads/lists target an existing path so we can
    // canonicalize directly; a write target may not exist yet, so canonicalize the nearest
    // existing ancestor and re-append the (traversal-checked) remaining tail.
    let resolved: PathBuf = if requested.exists() {
        requested.canonicalize().map_err(|e| e.to_string())?
    } else {
        let mut ancestor = requested;
        let mut tail: Vec<std::ffi::OsString> = Vec::new();
        loop {
            let parent = ancestor.parent()
                .ok_or_else(|| format!("Cannot resolve path: {}", path))?;
            if let Some(name) = ancestor.file_name() { tail.push(name.to_os_string()); }
            if parent.exists() || parent.as_os_str().is_empty() {
                let base_dir = if parent.as_os_str().is_empty() { Path::new(".") } else { parent };
                let mut base = base_dir.canonicalize().map_err(|e| e.to_string())?;
                for seg in tail.iter().rev() {
                    if seg == ".." || seg == "." { return Err("Path traversal is not allowed.".into()) }
                    base.push(seg);
                }
                break base;
            }
            ancestor = parent;
        }
    };

    // (2) Allowed roots: the user's home and the system temp dir.
    let home = std::env::var("HOME").ok().map(PathBuf::from).and_then(|h| h.canonicalize().ok());
    let tmp = std::env::temp_dir().canonicalize().ok();
    let tmp2 = Path::new("/tmp").canonicalize().ok();          // → /private/tmp on macOS
    let in_root = [home.as_ref(), tmp.as_ref(), tmp2.as_ref()]
        .into_iter().flatten()
        .any(|root| resolved.starts_with(root));
    if !in_root {
        return Err("Access denied: path is outside the allowed area (home or temp).".into());
    }

    // (3) Deny sensitive segments/files even inside home (credential + key material).
    let lower = resolved.to_string_lossy().to_lowercase();
    const DENY_SEGMENTS: &[&str] = &[
        "/.ssh/", "/.aws/", "/.gnupg/", "/.gpg/", "/.kube/", "/.docker/",
        "/.config/gcloud/", "/.azure/", "/.password-store/", "/.claude/",
        "/library/keychains/", "/keychains/",
        "/.mozilla/", "/.config/google-chrome/",
        "/library/application support/google/chrome/",
        "/library/application support/firefox/",
    ];
    if DENY_SEGMENTS.iter().any(|s| lower.contains(s)) {
        return Err("Access denied: sensitive location.".into());
    }
    let deny_file = lower.ends_with("/.netrc") || lower.ends_with("/.npmrc")
        || lower.ends_with("/.pypirc") || lower.ends_with("/.env")
        || lower.contains("/.env.") || lower.ends_with(".pem") || lower.ends_with(".key")
        || lower.ends_with("/id_rsa") || lower.ends_with("/id_ed25519") || lower.ends_with("/id_dsa");
    if deny_file {
        return Err("Access denied: sensitive file.".into());
    }
    Ok(resolved)
}

/// Read a local file as UTF-8 text (≤ 2MB). Used by the filesystem tool.
#[tauri::command]
async fn read_local_file(path: String) -> Result<String, String> {
    let p = confine_path(&path)?;
    if !p.exists() { return Err(format!("File not found: {}", path)) }
    let meta = std::fs::metadata(&p).map_err(|e| e.to_string())?;
    if meta.len() > 2 * 1024 * 1024 {
        return Err(format!("File too large ({} bytes). Max 2 MB.", meta.len()))
    }
    std::fs::read_to_string(&p).map_err(|e| e.to_string())
}

/// List files and directories at the given path (non-recursive).
#[tauri::command]
async fn list_directory(path: String) -> Result<Vec<serde_json::Value>, String> {
    let p = confine_path(&path)?;
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
    let p = confine_path(&path)?;
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&p, content).map_err(|e| e.to_string())
}

fn main() {
    // Cmd+Shift+Space — summon/hide Noetica from anywhere on the system
    let global_shortcut = Shortcut::new(
        Some(Modifiers::SUPER | Modifiers::SHIFT),
        Code::Space,
    );

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
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
        .manage(Mutex::new(AgentMachineState { port: None, am_pid: None }))
        .setup(|app| {
            let h = app.handle();

            // ── Run in background like Claude Desktop ─────────────────────────
            // Closing the window HIDES it (the Agent Machine, voice loop, and model
            // keep running). Real quit is Cmd+Q or the tray's Quit — both fire
            // RunEvent::Exit, which tears the sidecars down.
            if let Some(win) = app.get_webview_window("main") {
                let w = win.clone();
                win.on_window_event(move |event| {
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = w.hide();
                    }
                });
            }

            // ── Menu-bar (tray) icon — Show / Quit; left-click toggles the window ──
            // Non-fatal: a failure here must never propagate out of setup and abort the macOS
            // launch path (a panic across did_finish_launching can't unwind → SIGABRT). Log and
            // run on without a tray rather than taking the whole app down.
            if let Err(e) = (|| -> tauri::Result<()> {
                let show = MenuItemBuilder::with_id("tray_show", "Show Noetica").build(app)?;
                let quit = MenuItemBuilder::with_id("tray_quit", "Quit Noetica").build(app)?;
                let tray_menu = MenuBuilder::new(app).items(&[&show, &quit]).build()?;
                let mut tray_builder = TrayIconBuilder::with_id("noetica-tray")
                    .icon_as_template(true)
                    .tooltip("Noetica")
                    .menu(&tray_menu)
                    .show_menu_on_left_click(false);
                // Dedicated ℵ₀ glyph (aleph-null — the cardinality the wordmark N₀ always
                // gestured at). A single bold mark reads at menu-bar scale where the full
                // app icon turns to mush; embedded so there's no resource-path dependency.
                // Falls back to the window icon if the bytes ever fail to decode.
                match tauri::image::Image::from_bytes(include_bytes!("../icons/tray-aleph-template.png")) {
                    Ok(icon) => { tray_builder = tray_builder.icon(icon); }
                    Err(_) => {
                        if let Some(icon) = app.default_window_icon().cloned() {
                            tray_builder = tray_builder.icon(icon);  // no unwrap — never panic on startup
                        }
                    }
                }
                let _tray = tray_builder
                    .on_menu_event(|app, event| match event.id().as_ref() {
                        "tray_show" => {
                            if let Some(w) = app.get_webview_window("main") { let _ = w.show(); let _ = w.set_focus(); }
                        }
                        "tray_quit" => { SHUTTING_DOWN.store(true, Ordering::SeqCst); app.exit(0); }
                        _ => {}
                    })
                    .on_tray_icon_event(|tray, event| {
                        if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                            let app = tray.app_handle();
                            if let Some(w) = app.get_webview_window("main") {
                                if w.is_visible().unwrap_or(false) { let _ = w.hide(); }
                                else { let _ = w.show(); let _ = w.set_focus(); }
                            }
                        }
                    })
                    .build(app)?;
                Ok(())
            })() {
                eprintln!("[tray] setup failed (non-fatal): {}", e);
            }

            // ── Ollama sidecar (opt-in, default OFF) ──────────────────────────
            // The Agent Machine now OWNS its model runtime: on boot it provisions a
            // COMPLETE Ollama into ~/.noetica/runtime and runs it under a sandbox
            // (managed-runtime). Spawning the bundled Ollama here is redundant — and
            // historically harmful: the bundled binary ships without its inference
            // runner, so it answers /api/tags but 500s on generation, which used to
            // shadow the managed runtime. Default OFF; set NOETICA_SPAWN_BUNDLED_OLLAMA=1
            // only for debugging the bundled binary.
            if std::env::var("NOETICA_SPAWN_BUNDLED_OLLAMA").is_ok() {
            let noetica_models = std::env::var("HOME")
                .map(|h| format!("{h}/.noetica/models"))
                .unwrap_or_else(|_| "~/.noetica/models".to_string());
            match h.shell().sidecar("ollama") {
                Ok(cmd) => {
                    match cmd
                        .args(["serve"])
                        .env("OLLAMA_HOST", "127.0.0.1:11435")
                        .env("OLLAMA_MODELS", &noetica_models)
                        .spawn()
                    {
                        Ok((mut rx, _child)) => {
                            let _ = h.emit("noetica:ollama:started", serde_json::json!({
                                "host": "http://127.0.0.1:11435"
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
            } else {
                eprintln!("[noetica-ollama] bundled Ollama spawn skipped — the Agent Machine provisions + manages its own runtime (set NOETICA_SPAWN_BUNDLED_OLLAMA=1 to override)");
            }

            // ── Agent Machine sidecar ──────────────────────────────────────────
            // Attempt to start the bundled agent-machine binary.
            // In dev mode (no binary present), this fails silently — users can
            // start the AM manually with `npm run agent-machine`.
            let am_port: u16 = std::env::var("NOETICA_AM_PORT")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(8080);

            // Spawn the Agent Machine under a watchdog: a backend crash (most often an OOM
            // under heavy local-model load) re-spawns itself instead of dead-ending the UI
            // at "Load failed". Long-lived runs refresh the retry budget; rapid crash-loops
            // are bounded.
            spawn_agent_machine(h.clone(), am_port, MAX_AM_RETRIES);

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
            keychain_set,
            keychain_get,
            keychain_delete,
            take_screenshot,
            execute_computer_action,
            read_local_file,
            list_directory,
            write_local_file,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Noetica desktop shell")
        .run(|app_handle, event| {
            // On exit, gracefully stop the Agent Machine sidecar. Tauri does NOT kill
            // sidecar children on quit (they reparent to launchd), and a hard kill would
            // orphan the managed `ollama serve` it spawned. SIGTERM lets the Agent
            // Machine run its own teardown (which SIGKILLs the managed Ollama), so we
            // don't accumulate a leaked llama server on every launch.
            if let tauri::RunEvent::Exit = event {
                SHUTTING_DOWN.store(true, Ordering::SeqCst);  // stop the watchdog resurrecting it
                let pid = app_handle
                    .try_state::<Mutex<AgentMachineState>>()
                    .and_then(|s| s.lock().ok().and_then(|g| g.am_pid));
                if let Some(pid) = pid {
                    let _ = std::process::Command::new("kill")
                        .arg("-TERM")
                        .arg(pid.to_string())
                        .status();
                }
            }
            // Clicking the dock icon while hidden (macOS) re-shows the window. RunEvent::Reopen is a macOS-ONLY
            // variant, so gate it — otherwise the desktop shell fails to compile on Linux (the future-primary
            // target). `event`/`app_handle` are still used by the Exit arm above, so no unused warnings on Linux.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = event {
                if let Some(w) = app_handle.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            }
        });
}
