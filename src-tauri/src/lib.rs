
mod terminal_pty;
mod visual;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::Manager;
use terminal_pty::TerminalSession;

pub(crate) struct TerminalState {
    pub(crate) sessions: Mutex<HashMap<String, TerminalSession>>,
}

#[tauri::command]
fn terminal_shell_info() -> String {
    #[cfg(target_os = "windows")]
    {
        std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".to_string())
    }

    #[cfg(not(target_os = "windows"))]
    {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string())
    }
}

/// Compile and run the selected .java / .cpp / .py file under its watcher and
/// return the snapshots. (The command name is unchanged so the existing
/// capability / permission entry keeps working.)
///
/// `async` makes Tauri run it off the main thread, so the UI (and the Run
/// button's spinner) stays responsive while compiling.
#[tauri::command(async)]
fn run_java_visualizer(
    app: tauri::AppHandle,
    source_path: String,
) -> Result<visual::RunResult, String> {
    // Packaged app: bundled resources. Development: src-tauri/ and src-tauri/resources/.
    let mut roots: Vec<PathBuf> = Vec::new();
    if let Ok(dir) = app.path().resource_dir() {
        roots.push(dir.join("resources"));
        roots.push(dir);
    }
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    roots.push(dev.join("resources"));
    roots.push(dev);

    visual::run(&source_path, roots)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(TerminalState {
            sessions: Mutex::new(HashMap::new()),
        })
        .invoke_handler(tauri::generate_handler![
            terminal_shell_info,
            run_java_visualizer,
            terminal_pty::start_terminal,
            terminal_pty::write_terminal,
            terminal_pty::resize_terminal,
            terminal_pty::stop_terminal
        ])
        .run(tauri::generate_context!())
        .expect("error while running JavaLens");
}