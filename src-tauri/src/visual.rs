//! Compile + run a user program under the matching watcher and return snapshots.
//!
//! Java   : java --add-modules jdk.jdi Watcher X X.java   (stdout = JSON; the watcher compiles X itself)
//! C++    : g++ -std=c++17 -g -O0 -include memtrack.h X.cpp -o X -> cpp-watcher ./X snapshots.json
//! Python : python3 -m py_compile X.py -> python3 watcher.py X.py snapshots.json
//!
//! Watchers are built once into a cache directory (rebuilt only when their
//! source changes). Every run uses its own temp directory that is removed
//! when the run ends, and only one run may be active at a time.

use serde::Serialize;
use serde_json::Value;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex, TryLockError};
use std::thread;
use std::time::{Duration, Instant};

const BUILD_TIMEOUT: Duration = Duration::from_secs(180);
const RUN_TIMEOUT: Duration = Duration::from_secs(60);

static RUN_LOCK: Mutex<()> = Mutex::new(());

#[derive(Serialize)]
pub struct RunResult {
    pub success: bool,
    pub compile_stdout: String,
    pub compile_stderr: String,
    pub run_stdout: String,
    pub run_stderr: String,
    pub snapshots: Value,
    /// Short human-readable summary of what went wrong (empty on success).
    pub message: String,
}

impl RunResult {
    fn failed(message: impl Into<String>) -> Self {
        RunResult {
            success: false,
            compile_stdout: String::new(),
            compile_stderr: String::new(),
            run_stdout: String::new(),
            run_stderr: String::new(),
            snapshots: Value::Array(Vec::new()),
            message: message.into(),
        }
    }
}

#[derive(Clone, Copy, PartialEq)]
enum Lang {
    Java,
    Cpp,
    Python,
}

fn detect_language(path: &Path) -> Result<Lang, String> {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .as_deref()
    {
        Some("java") => Ok(Lang::Java),
        Some("cpp") | Some("cc") | Some("cxx") => Ok(Lang::Cpp),
        Some("py") => Ok(Lang::Python),
        _ => Err("Visual mode supports .java, .cpp and .py files.".to_string()),
    }
}

// ───────────────────────── process helpers ─────────────────────────

struct CmdOutput {
    ok: bool,
    timed_out: bool,
    code: Option<i32>,
    stdout: String,
    stderr: String,
}

fn spawn_error(what: &str, e: &std::io::Error) -> String {
    if e.kind() == std::io::ErrorKind::NotFound {
        format!("Could not start `{what}`. Make sure it is installed and on your PATH.")
    } else {
        format!("Could not start `{what}`: {e}")
    }
}

fn drain(mut pipe: impl Read + Send + 'static) -> (Arc<Mutex<Vec<u8>>>, thread::JoinHandle<()>) {
    let buf = Arc::new(Mutex::new(Vec::new()));
    let sink = Arc::clone(&buf);
    let handle = thread::spawn(move || {
        let mut chunk = [0u8; 8192];
        while let Ok(n) = pipe.read(&mut chunk) {
            if n == 0 {
                break;
            }
            if let Ok(mut b) = sink.lock() {
                b.extend_from_slice(&chunk[..n]);
            }
        }
    });
    (buf, handle)
}

fn take_text(buf: &Arc<Mutex<Vec<u8>>>) -> String {
    buf.lock()
        .map(|b| String::from_utf8_lossy(&b).into_owned())
        .unwrap_or_default()
}

/// Run a command to completion with a real timeout. Output is captured
/// incrementally so a killed process still returns whatever it printed.
fn run_cmd(cmd: &mut Command, what: &str, timeout: Duration) -> Result<CmdOutput, String> {
    cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = cmd.spawn().map_err(|e| spawn_error(what, &e))?;

    let (out_buf, out_thread) = drain(child.stdout.take().ok_or("stdout unavailable")?);
    let (err_buf, err_thread) = drain(child.stderr.take().ok_or("stderr unavailable")?);

    let start = Instant::now();
    let (status, timed_out) = loop {
        match child.try_wait() {
            Ok(Some(status)) => break (Some(status), false),
            Ok(None) if start.elapsed() >= timeout => {
                let _ = child.kill();
                break (child.wait().ok(), true);
            }
            Ok(None) => thread::sleep(Duration::from_millis(20)),
            Err(e) => return Err(format!("Failed while waiting for `{what}`: {e}")),
        }
    };

    // Grandchildren may keep a pipe open; never block on them for long.
    let grace = Instant::now();
    while !(out_thread.is_finished() && err_thread.is_finished())
        && grace.elapsed() < Duration::from_secs(2)
    {
        thread::sleep(Duration::from_millis(10));
    }

    Ok(CmdOutput {
        ok: status.map(|s| s.success()).unwrap_or(false) && !timed_out,
        timed_out,
        code: status.and_then(|s| s.code()),
        stdout: take_text(&out_buf),
        stderr: take_text(&err_buf),
    })
}

// ───────────────────────── files and caching ─────────────────────────

/// Per-run temp directory, removed on drop (success, failure or early return).
struct RunDir(PathBuf);

impl RunDir {
    fn create() -> Result<Self, String> {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let dir = std::env::temp_dir().join(format!("javalens-run-{}-{nanos}", std::process::id()));
        std::fs::create_dir_all(&dir)
            .map_err(|e| format!("Could not create temporary directory: {e}"))?;
        Ok(RunDir(dir))
    }
}

impl Drop for RunDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn cache_dir() -> Result<PathBuf, String> {
    let dir = std::env::temp_dir().join("javalens-watcher-cache");
    std::fs::create_dir_all(&dir).map_err(|e| format!("Could not create watcher cache: {e}"))?;
    Ok(dir)
}

/// True when `output` is missing or older than `source`.
fn needs_build(output: &Path, source: &Path) -> bool {
    match (
        std::fs::metadata(output).and_then(|m| m.modified()),
        std::fs::metadata(source).and_then(|m| m.modified()),
    ) {
        (Ok(o), Ok(s)) => s > o,
        _ => true,
    }
}

/// Find a bundled file (packaged resources first, then the dev tree).
/// `roots` is ordered by priority; each candidate is tried under every root.
fn find_resource(roots: &[PathBuf], candidates: &[&str]) -> Result<PathBuf, String> {
    for root in roots {
        for name in candidates {
            let p = root.join(name);
            if p.is_file() {
                return Ok(p);
            }
        }
    }
    Err(format!(
        "{} was not found. Searched: {}",
        candidates[0],
        roots
            .iter()
            .map(|r| r.display().to_string())
            .collect::<Vec<_>>()
            .join(", ")
    ))
}

fn parse_snapshots_text(text: &str) -> Value {
    // A single JSON document (file output) or the last JSON-array line (stdout).
    if let Ok(v) = serde_json::from_str::<Value>(text.trim()) {
        if v.is_array() {
            return v;
        }
    }
    text.lines()
        .rev()
        .find_map(|l| serde_json::from_str::<Value>(l.trim()).ok().filter(|v| v.is_array()))
        .unwrap_or_else(|| Value::Array(Vec::new()))
}

/// Shared tail: turn watcher output into a RunResult, refusing empty snapshots.
fn finish(
    compile_stdout: String,
    compile_stderr: String,
    run: &CmdOutput,
    snapshots: Value,
) -> RunResult {
    let count = snapshots.as_array().map(|a| a.len()).unwrap_or(0);
    let (success, message) = if run.timed_out {
        (false, format!("The program did not finish within {} seconds and was stopped.", RUN_TIMEOUT.as_secs()))
    } else if count == 0 {
        (false, "The program ran, but no snapshots were captured.".to_string())
    } else if !run.ok {
        (true, format!("The program exited with code {}; snapshots up to that point were kept.", run.code.map(|c| c.to_string()).unwrap_or_else(|| "?".into())))
    } else {
        (true, String::new())
    };
    RunResult {
        success,
        compile_stdout,
        compile_stderr,
        run_stdout: run.stdout.clone(),
        run_stderr: run.stderr.clone(),
        snapshots: if success { snapshots } else { Value::Array(Vec::new()) },
        message,
    }
}

fn build_failure(compile_stdout: String, compile_stderr: String, message: &str) -> RunResult {
    RunResult {
        compile_stdout,
        compile_stderr,
        message: message.to_string(),
        ..RunResult::failed("")
    }
}

// ───────────────────────── entry point ─────────────────────────

pub fn run(source_path: &str, resource_roots: Vec<PathBuf>) -> Result<RunResult, String> {
    let source = PathBuf::from(source_path);
    if !source.is_file() {
        return Err(format!("Source file does not exist: {}", source.display()));
    }
    let lang = detect_language(&source)?;

    // One run at a time: no duplicate compiles or watcher processes.
    let _guard = match RUN_LOCK.try_lock() {
        Ok(g) => g,
        Err(TryLockError::Poisoned(p)) => p.into_inner(),
        Err(TryLockError::WouldBlock) => return Err("A run is already in progress.".to_string()),
    };

    let source = source
        .canonicalize()
        .map_err(|e| format!("Could not resolve source file: {e}"))?;
    let source_dir = source
        .parent()
        .ok_or("Could not resolve the source directory")?
        .to_path_buf();
    let stem = source
        .file_stem()
        .and_then(|s| s.to_str())
        .ok_or("Could not determine the file name")?
        .to_string();

    match lang {
        Lang::Java => run_java(&source, &source_dir, &stem, &resource_roots),
        Lang::Cpp => run_cpp(&source, &source_dir, &stem, &resource_roots),
        Lang::Python => run_python(&source, &source_dir, &resource_roots),
    }
}

// ───────────────────────── Java ─────────────────────────

fn run_java(source: &Path, source_dir: &Path, stem: &str, roots: &[PathBuf]) -> Result<RunResult, String> {
    let watcher_src = find_resource(roots, &["java/Watcher.java", "Watcher.java"])?;

    // javac --add-modules jdk.jdi -g Watcher.java   (cached)
    let classes = cache_dir()?.join("java");
    std::fs::create_dir_all(&classes).map_err(|e| format!("Could not create Watcher build directory: {e}"))?;
    if needs_build(&classes.join("Watcher.class"), &watcher_src) {
        let build = run_cmd(
            Command::new("javac")
                .args(["--add-modules", "jdk.jdi", "-g", "-d"])
                .arg(&classes)
                .arg(&watcher_src),
            "javac",
            BUILD_TIMEOUT,
        )?;
        if !build.ok {
            return Ok(build_failure(
                String::new(),
                format!("Watcher compilation failed:\n{}\n{}", build.stdout, build.stderr),
                "Could not build the Java watcher.",
            ));
        }
    }

    // java --add-modules jdk.jdi Watcher X X.java   (stdout = snapshots JSON)
    let sep = if cfg!(windows) { ";" } else { ":" };
    let class_path = format!("{}{}{}", classes.display(), sep, source_dir.display());
    // The watcher creates a temp dir for its generated copy of the program;
    // point java.io.tmpdir at our per-run directory so it is always cleaned up.
    let run_dir = RunDir::create()?;
    let run = run_cmd(
        Command::new("java")
            .arg(format!("-Djava.io.tmpdir={}", run_dir.0.display()))
            .args(["--add-modules", "jdk.jdi", "-cp"])
            .arg(class_path)
            .arg("Watcher")
            .arg(stem)
            .arg(source)
            .current_dir(source_dir),
        "java",
        RUN_TIMEOUT,
    )?;
    let snapshots = parse_snapshots_text(&run.stdout);
    // The watcher compiles a generated copy of the program (it injects point())
    // and reports javac diagnostics on stderr; surface those as compile errors.
    let no_snapshots = snapshots.as_array().map(|a| a.is_empty()).unwrap_or(true);
    if !run.ok && no_snapshots && run.stderr.contains("compilation failed") {
        return Ok(build_failure(String::new(), run.stderr, "Compilation failed."));
    }
    Ok(finish(String::new(), String::new(), &run, snapshots))
}

// ───────────────────────── C++ ─────────────────────────

fn run_cpp(source: &Path, source_dir: &Path, stem: &str, roots: &[PathBuf]) -> Result<RunResult, String> {
    let watcher_src = find_resource(roots, &["cpp/watcher.cpp", "watcher.cpp"])?;
    let memtrack = find_resource(roots, &["cpp/memtrack.h", "memtrack.h"])?;
    let memtrack_dir = memtrack.parent().unwrap_or(Path::new(".")).to_path_buf();

    // clang++ -std=c++17 -g watcher.cpp -o cpp-watcher -llldb   (cached)
    let watcher_bin = cache_dir()?.join(format!("cpp-watcher{}", std::env::consts::EXE_SUFFIX));
    if needs_build(&watcher_bin, &watcher_src) {
        let build = run_cmd(
            Command::new("clang++")
                .args(["-std=c++17", "-g"])
                .arg(&watcher_src)
                .arg("-o")
                .arg(&watcher_bin)
                .arg("-llldb"),
            "clang++",
            BUILD_TIMEOUT,
        )?;
        if !build.ok {
            return Ok(build_failure(
                String::new(),
                format!(
                    "C++ watcher build failed (needs clang++ and the LLDB development library):\n{}\n{}",
                    build.stdout, build.stderr
                ),
                "Could not build the C++ watcher.",
            ));
        }
    }

    let run_dir = RunDir::create()?;
    let exe = run_dir.0.join(format!("{stem}{}", std::env::consts::EXE_SUFFIX));
    let snap_file = run_dir.0.join("snapshots.json");

    // g++ -std=c++17 -g -O0 -include memtrack.h X.cpp -o X
    let compile = run_cmd(
        Command::new("g++")
            .args(["-std=c++17", "-g", "-O0", "-include"])
            .arg(&memtrack)
            .arg("-I")
            .arg(&memtrack_dir) // lets `#include "memtrack.h"` resolve too
            .arg(source)
            .arg("-o")
            .arg(&exe)
            .current_dir(source_dir),
        "g++",
        BUILD_TIMEOUT,
    )?;
    if !compile.ok {
        return Ok(build_failure(compile.stdout, compile.stderr, "Compilation failed."));
    }

    // ./cpp-watcher ./X snapshots.json
    let run = run_cmd(
        Command::new(&watcher_bin).arg(&exe).arg(&snap_file).current_dir(source_dir),
        "cpp-watcher",
        RUN_TIMEOUT,
    )?;
    let snapshots = std::fs::read_to_string(&snap_file)
        .map(|t| parse_snapshots_text(&t))
        .unwrap_or_else(|_| Value::Array(Vec::new()));
    Ok(finish(compile.stdout, compile.stderr, &run, snapshots))
}

// ───────────────────────── Python ─────────────────────────

fn find_python() -> Result<&'static str, String> {
    for exe in ["python3", "python"] {
        if let Ok(out) = Command::new(exe).arg("--version").output() {
            let text = format!(
                "{}{}",
                String::from_utf8_lossy(&out.stdout),
                String::from_utf8_lossy(&out.stderr)
            );
            if out.status.success() && text.trim_start().starts_with("Python 3") {
                return Ok(exe);
            }
        }
    }
    Err("Could not find Python 3. Install it and make sure `python3` is on your PATH.".to_string())
}

fn run_python(source: &Path, source_dir: &Path, roots: &[PathBuf]) -> Result<RunResult, String> {
    let watcher_src = find_resource(roots, &["python/watcher.py", "watcher.py"])?;
    let python = find_python()?;
    let cache = cache_dir()?;

    // python3 -m py_compile watcher.py   (cached; bytecode goes to the cache,
    // never into the possibly read-only app bundle)
    let stamp = cache.join("watcher.py.ok");
    if needs_build(&stamp, &watcher_src) {
        let check = run_cmd(
            Command::new(python)
                .args(["-m", "py_compile"])
                .arg(&watcher_src)
                .env("PYTHONPYCACHEPREFIX", cache.join("pycache")),
            python,
            BUILD_TIMEOUT,
        )?;
        if !check.ok {
            return Ok(build_failure(
                String::new(),
                format!("Python watcher check failed:\n{}\n{}", check.stdout, check.stderr),
                "Could not compile the Python watcher.",
            ));
        }
        let _ = std::fs::write(&stamp, b"ok");
    }

    let run_dir = RunDir::create()?;
    let snap_file = run_dir.0.join("snapshots.json");

    // Syntax-check the user's file so errors are reported as compile errors.
    let compile = run_cmd(
        Command::new(python)
            .args(["-m", "py_compile"])
            .arg(source)
            .env("PYTHONPYCACHEPREFIX", run_dir.0.join("pycache"))
            .current_dir(source_dir),
        python,
        BUILD_TIMEOUT,
    )?;
    if !compile.ok {
        return Ok(build_failure(compile.stdout, compile.stderr, "Compilation failed."));
    }

    // python3 watcher.py X.py snapshots.json
    let run = run_cmd(
        Command::new(python)
            .arg(&watcher_src)
            .arg(source)
            .arg(&snap_file)
            .env("PYTHONPYCACHEPREFIX", run_dir.0.join("pycache"))
            .env("PYTHONPATH", source_dir) // sibling imports keep working
            .env("PYTHONUNBUFFERED", "1")
            .current_dir(source_dir),
        python,
        RUN_TIMEOUT,
    )?;
    let snapshots = std::fs::read_to_string(&snap_file)
        .map(|t| parse_snapshots_text(&t))
        .unwrap_or_else(|_| Value::Array(Vec::new()));
    Ok(finish(compile.stdout, compile.stderr, &run, snapshots))
}