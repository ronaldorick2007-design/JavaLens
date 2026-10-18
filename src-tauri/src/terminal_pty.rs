
use crate::TerminalState;
use portable_pty::{
    native_pty_system, Child, CommandBuilder, MasterPty, PtySize,
};
use serde::Serialize;
use std::{
    io::{Read, Write},
    sync::{Arc, Mutex},
    thread,
};
use tauri::{AppHandle, Emitter, State};

pub(crate) struct TerminalSession {
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    master: Box<dyn MasterPty + Send>,
    child: Box<dyn Child + Send + Sync>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TerminalOutput {
    session_id: String,
    data: String,
}

fn shell_path() -> String {
    #[cfg(target_os = "windows")]
    {
        std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".into())
    }

    #[cfg(not(target_os = "windows"))]
    {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".into())
    }
}

#[tauri::command]
pub fn start_terminal(
    app: AppHandle,
    state: State<'_, TerminalState>,
) -> Result<String, String> {
    let pty_system = native_pty_system();

    let pair = pty_system
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;

    let mut command = CommandBuilder::new(shell_path());
    command.env("TERM", "xterm-256color");

    let child = pair
        .slave
        .spawn_command(command)
        .map_err(|e| e.to_string())?;

    drop(pair.slave);

    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| e.to_string())?;

    let writer = pair
        .master
        .take_writer()
        .map_err(|e| e.to_string())?;

    let session_id = uuid::Uuid::new_v4().to_string();
    let output_session_id = session_id.clone();

    let session = TerminalSession {
        writer: Arc::new(Mutex::new(writer)),
        master: pair.master,
        child,
    };

    state
        .sessions
        .lock()
        .map_err(|e| e.to_string())?
        .insert(session_id.clone(), session);

    thread::spawn(move || {
        read_terminal_output(reader, app, output_session_id);
    });

    Ok(session_id)
}

fn read_terminal_output(
    mut reader: Box<dyn Read + Send>,
    app: AppHandle,
    session_id: String,
) {
    let mut buffer = [0_u8; 4096];

    loop {
        match reader.read(&mut buffer) {
            Ok(0) => break,
            Ok(count) => {
                let data =
                    String::from_utf8_lossy(&buffer[..count]).to_string();

                let event = TerminalOutput {
                    session_id: session_id.clone(),
                    data,
                };

                if app.emit("terminal-output", event).is_err() {
                    break;
                }
            }
            Err(_) => break,
        }
    }
}

#[tauri::command]
pub fn write_terminal(
    state: State<'_, TerminalState>,
    session_id: String,
    data: String,
) -> Result<(), String> {
    let sessions = state
        .sessions
        .lock()
        .map_err(|e| e.to_string())?;

    let session = sessions
        .get(&session_id)
        .ok_or_else(|| "Terminal session not found".to_string())?;

    let mut writer = session
        .writer
        .lock()
        .map_err(|e| e.to_string())?;

    writer.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
    writer.flush().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn resize_terminal(
    state: State<'_, TerminalState>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let sessions = state
        .sessions
        .lock()
        .map_err(|e| e.to_string())?;

    let session = sessions
        .get(&session_id)
        .ok_or_else(|| "Terminal session not found".to_string())?;

    session
        .master
        .resize(PtySize {
            rows: rows.max(1),
            cols: cols.max(1),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn stop_terminal(
    state: State<'_, TerminalState>,
    session_id: String,
) -> Result<(), String> {
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|e| e.to_string())?;

    if let Some(mut session) = sessions.remove(&session_id) {
        let _ = session.child.kill();
    }

    Ok(())
}
