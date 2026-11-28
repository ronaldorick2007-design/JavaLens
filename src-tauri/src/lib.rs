use portable_pty::{CommandBuilder, PtySize, native_pty_system};
use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::io::{Read, Write};
use std::path::Path;
use std::sync::Mutex;
use std::sync::atomic::{AtomicU32, Ordering};
use tauri::{AppHandle, Emitter, State};

mod visual;   // async visual_trace (runs off the UI thread)

/* =========================
   FILE MANAGER
========================= */

#[derive(Serialize)]
struct FileEntry {
    name: String,
    path: String,
    is_dir: bool,
    children: Vec<FileEntry>,
}

#[tauri::command]
fn read_file(path: String) -> Result<String, String> {
    fs::read_to_string(path).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_file(path: String, content: String) -> Result<(), String> {
    fs::write(path, content).map_err(|e| e.to_string())
}

fn read_directory(path: &Path) -> Result<Vec<FileEntry>, String> {
    let entries = fs::read_dir(path).map_err(|e| e.to_string())?;
    let mut result = Vec::new();

    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        let is_dir = path.is_dir();

        result.push(FileEntry {
            name: entry.file_name().to_string_lossy().to_string(),
            path: path.to_string_lossy().to_string(),
            is_dir,
            children: if is_dir {
                read_directory(&path).unwrap_or_default()
            } else {
                Vec::new()
            },
        });
    }

    Ok(result)
}

#[tauri::command]
fn read_folder(path: String) -> Result<Vec<FileEntry>, String> {
    read_directory(Path::new(&path))
}

/* =========================
   TERMINAL
========================= */

struct TerminalSession {
    master: Box<dyn portable_pty::MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn portable_pty::Child + Send>,
}

struct TerminalState {
    sessions: Mutex<HashMap<u32, TerminalSession>>,
    next_id: AtomicU32,
}

// The user's default shell: $SHELL, else the shell listed in /etc/passwd, else /bin/sh.
#[cfg(unix)]
fn default_shell() -> String {
    if let Ok(shell) = std::env::var("SHELL") { if !shell.is_empty() { return shell; } }
    let user = std::env::var("USER").or_else(|_| std::env::var("LOGNAME")).unwrap_or_default();
    fs::read_to_string("/etc/passwd").ok()
        .and_then(|text| text.lines()
            .find(|line| line.split(':').next() == Some(user.as_str()))
            .and_then(|line| line.split(':').nth(6))
            .map(|shell| shell.to_string()))
        .filter(|shell| !shell.is_empty())
        .unwrap_or_else(|| "/bin/sh".into())
}

#[tauri::command]
fn terminal_start(app: AppHandle, state: State<TerminalState>, cwd: Option<String>) -> Result<u32, String> {
    let pty_system = native_pty_system();

    let pair = pty_system
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;

    #[cfg(unix)]
    let shell = default_shell();

    #[cfg(windows)]
    let shell = std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".into());

    let default_dir = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_else(|_| ".".to_string());
    let working_dir = cwd
        .filter(|path| Path::new(path).is_dir())
        .unwrap_or(default_dir);

    let mut cmd = CommandBuilder::new(&shell);
    if cfg!(unix) && ["bash", "zsh", "fish"].iter().any(|name| shell.ends_with(name)) {
        cmd.arg("-l");                       // login shell: loads the user's PATH / rc files
    }
    cmd.env("TERM", "xterm-256color");
    cmd.cwd(working_dir);

    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;

    drop(pair.slave);

    let reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;

    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    let id = state.next_id.fetch_add(1, Ordering::Relaxed);

    state.sessions.lock().unwrap().insert(
        id,
        TerminalSession {
            master: pair.master,
            writer,
            child,
        },
    );

    std::thread::spawn(move || {
        let mut reader = reader;
        let mut buffer = [0u8; 4096];

        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,

                Ok(n) => {
                    let data = String::from_utf8_lossy(&buffer[..n]).to_string();

                    let _ = app.emit(
                        "terminal-output",
                        serde_json::json!({
                            "id": id,
                            "data": data
                        }),
                    );
                }

                Err(_) => break,
            }
        }
    });

    Ok(id)
}

#[tauri::command]
fn terminal_write(state: State<TerminalState>, id: u32, data: String) -> Result<(), String> {
    let mut sessions = state.sessions.lock().unwrap();

    let session = sessions.get_mut(&id).ok_or("Terminal not found")?;

    session
        .writer
        .write_all(data.as_bytes())
        .map_err(|e| e.to_string())?;

    session.writer.flush().map_err(|e| e.to_string())
}

#[tauri::command]
fn terminal_resize(
    state: State<TerminalState>,
    id: u32,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let sessions = state.sessions.lock().unwrap();

    let session = sessions.get(&id).ok_or("Terminal not found")?;

    session
        .master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn terminal_close(state: State<TerminalState>, id: u32) {
    if let Some(mut session) = state.sessions.lock().unwrap().remove(&id) {
        let _ = session.child.kill();
    }
}

/* =========================
   TAURI
========================= */

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(TerminalState {
            sessions: Mutex::new(HashMap::new()),
            next_id: AtomicU32::new(1),
        })
        .invoke_handler(tauri::generate_handler![
            read_file,
            write_file,
            visual::visual_trace,
            read_folder,
            terminal_start,
            terminal_write,
            terminal_resize,
            terminal_close
        ])
        .run(tauri::generate_context!())
        .expect("error while running Tauri");
}
