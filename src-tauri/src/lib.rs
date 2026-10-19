
mod terminal_pty;

use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Command;
use std::sync::Mutex;
use tauri::Manager;
use terminal_pty::TerminalSession;

pub(crate) struct TerminalState {
    pub(crate) sessions: Mutex<HashMap<String, TerminalSession>>,
}

#[derive(Serialize)]
struct JavaRunResult {
    success: bool,
    compile_stdout: String,
    compile_stderr: String,
    run_stdout: String,
    run_stderr: String,
    snapshots: Value,
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

/// Locate Watcher.java in a packaged app or the development source tree.
fn resolve_watcher_source(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    // Installed application: resolve the bundled resource.
    if let Ok(path) = app
        .path()
        .resolve("Watcher.java", tauri::path::BaseDirectory::Resource)
    {
        if path.is_file() {
            return Ok(path);
        }
    }

    // Development fallback: src-tauri/Watcher.java.
    let dev_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("Watcher.java");

    if dev_path.is_file() {
        return Ok(dev_path);
    }

    Err(format!(
        "Watcher.java was not found. Checked the bundled resource and development path: {}",
        dev_path.display()
    ))
}

/// Compile the selected Java file, run the JDI watcher, and return snapshots.
#[tauri::command]
fn run_java_visualizer(
    app: tauri::AppHandle,
    source_path: String,
) -> Result<JavaRunResult, String> {
    let source = PathBuf::from(&source_path);

    if !source.is_file() {
        return Err(format!(
            "Java source file does not exist: {}",
            source.display()
        ));
    }

    if source.extension().and_then(|s| s.to_str()) != Some("java") {
        return Err("Please select a .java source file.".to_string());
    }

    let source_dir = source
        .parent()
        .ok_or("Could not resolve Java source directory")?
        .canonicalize()
        .map_err(|e| format!("Could not resolve Java source directory: {e}"))?;

    let source = source
        .canonicalize()
        .map_err(|e| format!("Could not resolve Java source file: {e}"))?;

    let file_stem = source
        .file_stem()
        .and_then(|s| s.to_str())
        .ok_or("Could not determine Java class name from filename")?
        .to_string();

    // Resolve Watcher.java from the installed bundle or development tree.
    let watcher_source = resolve_watcher_source(&app)?;

    // Compile the user's Java program.
    let compile = Command::new("javac")
        .arg("-g")
        .arg(&source)
        .current_dir(&source_dir)
        .output()
        .map_err(|e| {
            format!(
                "Could not start javac. Install a JDK and ensure javac is on PATH. {e}"
            )
        })?;

    let compile_stdout = String::from_utf8_lossy(&compile.stdout).into_owned();
    let compile_stderr = String::from_utf8_lossy(&compile.stderr).into_owned();

    if !compile.status.success() {
        return Ok(JavaRunResult {
            success: false,
            compile_stdout,
            compile_stderr,
            run_stdout: String::new(),
            run_stderr: String::new(),
            snapshots: Value::Array(Vec::new()),
        });
    }

    // Compile watcher classes outside the source tree.
    let watcher_classes = std::env::temp_dir()
        .join("javalens-watcher-classes");

    std::fs::create_dir_all(&watcher_classes)
        .map_err(|e| format!("Could not create Watcher build directory: {e}"))?;

    let watcher_compile = Command::new("javac")
        .arg("--add-modules")
        .arg("jdk.jdi")
        .arg("-g")
        .arg("-d")
        .arg(&watcher_classes)
        .arg(&watcher_source)
        .output()
        .map_err(|e| format!("Could not compile Watcher.java: {e}"))?;

    if !watcher_compile.status.success() {
        let watcher_stdout =
            String::from_utf8_lossy(&watcher_compile.stdout);
        let watcher_stderr =
            String::from_utf8_lossy(&watcher_compile.stderr);

        return Ok(JavaRunResult {
            success: false,
            compile_stdout,
            compile_stderr: format!(
                "{}\nWatcher compilation failed:\n{}\n{}",
                compile_stderr, watcher_stdout, watcher_stderr
            ),
            run_stdout: String::new(),
            run_stderr: String::new(),
            snapshots: Value::Array(Vec::new()),
        });
    }

    // Run the watcher against the user's compiled Java class.
    let run = Command::new("java")
        .arg("--add-modules")
        .arg("jdk.jdi")
        .arg("-cp")
        .arg(&watcher_classes)
        .arg("Watcher")
        .arg(&file_stem)
        .current_dir(&source_dir)
        .output()
        .map_err(|e| {
            format!(
                "Could not start Java Watcher. Install a JDK and ensure java is on PATH. {e}"
            )
        })?;

    let run_stdout = String::from_utf8_lossy(&run.stdout).into_owned();
    let run_stderr = String::from_utf8_lossy(&run.stderr).into_owned();

    let snapshots = run_stdout
        .lines()
        .rev()
        .find_map(|line| serde_json::from_str::<Value>(line.trim()).ok())
        .unwrap_or_else(|| Value::Array(Vec::new()));

    Ok(JavaRunResult {
        success: run.status.success() && snapshots.is_array(),
        compile_stdout,
        compile_stderr,
        run_stdout,
        run_stderr,
        snapshots,
    })
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
