import { useCallback, useEffect, useRef, useState } from "react";

import JavaVisual from "./JavaVisual";
import Editor from "./Editor";
import Terminal from "./Terminal";
import Brand from "./Brand";
import Splitter from "./Splitter";
import Documentation from "./Documentation";
import { useTheme } from "./ThemeProvider";

import { open, save } from "@tauri-apps/plugin-dialog";
import { exists, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { invoke } from "@tauri-apps/api/core";
import { desktopDir, homeDir, join } from "@tauri-apps/api/path";

const basename = (path) =>
  path?.split(/[\\/]/).filter(Boolean).pop() || "Untitled";

// Folder part of a path (Windows or POSIX), or null.
const folderOf = (path) => {
  const match = path?.match(/^(.*)[\\/][^\\/]*$/);
  return match ? match[1] || "/" : null;
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

// Default name offered for an untitled tab, guessed from its code so the right
// extension (and therefore the right watcher) is picked.
function suggestFileName(tab) {
  if (tab.path || tab.name !== "New.java") return tab.name;

  const code = tab.content || "";
  const className = code.match(/\bpublic\s+class\s+(\w+)/);

  if (className) return `${className[1]}.java`;
  if (/\bpublic\s+static\s+void\s+main|\bSystem\.out\./.test(code)) return "Main.java";
  if (/#\s*include\s*[<"]|\bstd::|\bint\s+main\s*\(/.test(code)) return "main.cpp";
  if (/^\s*(def\s+\w+\s*\(|print\s*\(|for\s+\w+\s+in\s|from\s+\w+\s+import\s|import\s+\w+\s*$)/m.test(code)) return "main.py";

  return "Main.java";
}

export default function App() {
  const { theme, setTheme } = useTheme();

  const [tabs, setTabs] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [shell, setShell] = useState("default");
  const [terminalHeight, setTerminalHeight] = useState(220);
  const [visualRatio, setVisualRatio] = useState(0.5);
  const [currentLine, setCurrentLine] = useState(null);
  const [visualOpen, setVisualOpen] = useState(false);
  const [documentationOpen, setDocumentationOpen] = useState(false);
  const [visualRunning, setVisualRunning] = useState(false);
  // Snapshots are kept per file tab so Open Visual can reuse them without re-running.
  const [snapshotsByTab, setSnapshotsByTab] = useState({});
  const [notice, setNotice] = useState(null);

  const terminalOutputRef = useRef(null);
  const columnRef = useRef(null);
  const bodyRef = useRef(null);
  const runningRef = useRef(false);
  const lastDirRef = useRef(null);

  const active =
    tabs.find((tab) => tab.id === activeId) || tabs[0] || null;

  const snapshots = (active && snapshotsByTab[active.id]) || [];

  const write = (text) => terminalOutputRef.current?.(text);

  // Where file dialogs start: the active file's folder, then the last folder
  // used, then Desktop, then Home. A folder confirmed missing is skipped; one
  // that can't be checked is trusted (the OS dialog falls back on its own).
  async function startFolder() {
    const candidates = [folderOf(active?.path), lastDirRef.current];

    for (const lookup of [desktopDir, homeDir]) {
      try {
        candidates.push(await lookup());
      } catch {
        /* not available on this system; try the next one */
      }
    }

    for (const dir of candidates) {
      if (!dir) continue;
      try {
        if (await exists(dir)) return dir;
      } catch {
        return dir;
      }
    }

    return undefined;
  }

  async function dialogPath(fileName) {
    const dir = await startFolder();
    if (!dir) return fileName;
    try {
      return await join(dir, fileName);
    } catch {
      return fileName;
    }
  }

  const update = (patch) => {
    if (!active) return;

    setTabs((previous) =>
      previous.map((tab) =>
        tab.id === active.id ? { ...tab, ...patch } : tab
      )
    );
  };

  function newFile() {
    const tab = {
      id: crypto.randomUUID(),
      name: "New.java",
      path: null,
      content: "",
      dirty: false,
    };

    setTabs((previous) => [...previous, tab]);
    setActiveId(tab.id);
  }

  async function openFile() {
    try {
      const path = await open({
        defaultPath: await startFolder(),
        multiple: false,
        filters: [
          {
            name: "Source files",
            extensions: [
              "java",
              "txt",
              "js",
              "jsx",
              "ts",
              "tsx",
              "json",
              "rs",
              "c",
              "cpp",
              "cc",
              "cxx",
              "py",
              "h",
              "md",
            ],
          },
        ],
      });

      if (!path || typeof path !== "string") return;

      lastDirRef.current = folderOf(path);

      const existing = tabs.find((tab) => tab.path === path);

      if (existing) {
        setActiveId(existing.id);
        return;
      }

      const tab = {
        id: crypto.randomUUID(),
        name: basename(path),
        path,
        content: await readTextFile(path),
        dirty: false,
      };

      setTabs((previous) => [...previous, tab]);
      setActiveId(tab.id);
    } catch (error) {
      console.error("Open failed:", error);
      terminalOutputRef.current?.(
        `\x1b[31mOpen failed: ${String(error)}\x1b[0m`
      );
    }
  }

  async function saveFile(saveAs = false) {
    if (!active) return;

    try {
      let path = active.path;

      if (!path || saveAs) {
        path = await save({
          defaultPath: await dialogPath(suggestFileName(active)),
        });
      }

      if (!path) return;

      await writeTextFile(path, active.content);
      lastDirRef.current = folderOf(path);
      update({ path, name: basename(path), dirty: false });
    } catch (error) {
      console.error("Save failed:", error);
      terminalOutputRef.current?.(
        `\x1b[31mSave failed: ${String(error)}\x1b[0m`
      );
    }
  }

  function closeTab(id) {
    const index = tabs.findIndex((tab) => tab.id === id);
    const remaining = tabs.filter((tab) => tab.id !== id);

    setTabs(remaining);
    setSnapshotsByTab(({ [id]: _removed, ...rest }) => rest);

    if (
      activeId === id ||
      !remaining.some((tab) => tab.id === activeId)
    ) {
      setActiveId(
        remaining[Math.max(0, index - 1)]?.id ||
          remaining[0]?.id ||
          null
      );
    }
  }

  // Compile + run the active file under its watcher and store the snapshots.
  // Triggered by the topbar Run button.
  async function runProgram() {
    if (!active || runningRef.current) return;

    const tabId = active.id;
    const patchTab = (patch) =>
      setTabs((previous) =>
        previous.map((tab) => (tab.id === tabId ? { ...tab, ...patch } : tab))
      );
    let path = active.path;

    runningRef.current = true;

    try {
      if (!path) {
        path = await save({
          defaultPath: await dialogPath(suggestFileName(active)),
        });

        if (!path) return;
      }

      if (!/\.(java|cpp|cc|cxx|py)$/i.test(path)) {
        const text = "Visual mode supports .java, .cpp and .py files.";
        write(`\x1b[31m${text}\x1b[0m`);
        setNotice({ kind: "error", text });
        return;
      }

      try {
        await writeTextFile(path, active.content);
      } catch (error) {
        // The file's folder was moved/deleted or isn't writable: offer Desktop / Home.
        write(
          `\x1b[33m[JavaLens Visual] Could not save to ${path} (${String(error)}). Choose another location.\x1b[0m`
        );

        const retry = await save({ defaultPath: await dialogPath(basename(path)) });
        if (!retry) return;

        if (!/\.(java|cpp|cc|cxx|py)$/i.test(retry)) {
          const text = "Visual mode supports .java, .cpp and .py files.";
          write(`\x1b[31m${text}\x1b[0m`);
          setNotice({ kind: "error", text });
          return;
        }

        path = retry;
        await writeTextFile(path, active.content);
      }

      lastDirRef.current = folderOf(path);
      patchTab({ path, name: basename(path), dirty: false });

      setNotice(null);
      setVisualRunning(true);

      write(
        `\x1b[90m\r\n[JavaLens Visual] Compiling and running ${basename(path)}...\x1b[0m`
      );

      const result = await invoke("run_java_visualizer", {
        sourcePath: path,
      });

      if (result.compile_stdout) write(result.compile_stdout);

      if (result.compile_stderr) {
        write(`\x1b[31m${result.compile_stderr}\x1b[0m`);
      }

      if (result.run_stderr) {
        write(`\x1b[31m${result.run_stderr}\x1b[0m`);
      }

      if (
        result.success &&
        Array.isArray(result.snapshots) &&
        result.snapshots.length > 0
      ) {
        // Only replace the stored snapshots on success; a failed run keeps
        // whatever the visualizer was already showing.
        setSnapshotsByTab((previous) => ({
          ...previous,
          [tabId]: result.snapshots,
        }));

        write(
          `\x1b[32m[JavaLens Visual] Captured ${result.snapshots.length} snapshots.\x1b[0m`
        );
        if (result.message) write(`\x1b[33m${result.message}\x1b[0m`);

        setNotice({
          kind: "ok",
          text: visualOpen
            ? `${result.snapshots.length} snapshots loaded`
            : `${result.snapshots.length} snapshots ready – click Open Visual`,
        });
      } else {
        const text = result.message || "Run failed. No snapshots were captured.";
        write(`\x1b[31m[JavaLens Visual] ${text}\x1b[0m`);
        setNotice({ kind: "error", text });
      }
    } catch (error) {
      console.error("Visual run failed:", error);
      write(`\x1b[31m[JavaLens Visual] ${String(error)}\x1b[0m`);
      setNotice({ kind: "error", text: String(error) });
    } finally {
      runningRef.current = false;
      setVisualRunning(false);
    }
  }

  // Opens the visualizer from existing snapshots; never runs anything.
  function openVisual() {
    if (!active) return;

    if (snapshots.length === 0) {
      const text = "No snapshots found. Run the program first.";
      write(`\x1b[33m[JavaLens Visual] ${text}\x1b[0m`);
      setNotice({ kind: "error", text });
      return;
    }

    setNotice(null);
    setVisualOpen(true);
  }

  function closeVisual() {
    setVisualOpen(false);
    setCurrentLine(null);
  }

  // Clear the editor's current-line highlight when the shown file has no snapshots.
  useEffect(() => {
    if (snapshots.length === 0) setCurrentLine(null);
  }, [active?.id, snapshots.length]);

  // Transient topbar message.
  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(timer);
  }, [notice]);

  const actions = useRef({});
  actions.current = { newFile, openFile, saveFile };

  // Keep existing keyboard shortcuts.
  useEffect(() => {
    const onKeyDown = (event) => {
      if (!(event.ctrlKey || event.metaKey)) return;

      const key = event.key.toLowerCase();

      if (key === "n") {
        event.preventDefault();
        actions.current.newFile();
      } else if (key === "o") {
        event.preventDefault();
        void actions.current.openFile();
      } else if (key === "s") {
        event.preventDefault();
        void actions.current.saveFile(event.shiftKey);
      }
    };

    window.addEventListener("keydown", onKeyDown);

    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Prevent Ctrl + mouse-wheel from zooming the entire app.
  useEffect(() => {
    const preventZoom = (event) => {
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
      }
    };

    window.addEventListener("wheel", preventZoom, { passive: false });

    return () => {
      window.removeEventListener("wheel", preventZoom);
    };
  }, []);

  const resizeTerminal = useCallback((dy) => {
    const column = columnRef.current;
    if (!column) return;

    setTerminalHeight((height) =>
      clamp(
        height - dy,
        96,
        Math.max(96, column.clientHeight - 140)
      )
    );
  }, []);

  const resizeVisual = useCallback((dx) => {
    const body = bodyRef.current;
    if (!body) return;

    setVisualRatio((ratio) =>
      clamp(ratio - dx / body.clientWidth, 0.25, 0.75)
    );
  }, []);

  return (
    <div className="app">
      <header className="topbar">
        <Brand />

        <nav className="topbar-nav">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={newFile}
          >
            New <kbd>Ctrl N</kbd>
          </button>

          <button
            type="button"
            className="btn btn-ghost"
            onClick={openFile}
          >
            Open <kbd>Ctrl O</kbd>
          </button>

          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => saveFile()}
            disabled={!active}
          >
            Save <kbd>Ctrl S</kbd>
          </button>
        </nav>

        <div className="spacer" />

        {notice && (
          <span
            className={`topbar-notice ${notice.kind === "error" ? "topbar-notice-error" : "topbar-notice-ok"}`}
            role="status"
          >
            {notice.text}
          </span>
        )}

        <button
          type="button"
          className={`btn ${visualRunning ? "btn-busy" : ""}`}
          disabled={visualRunning || !active}
          aria-busy={visualRunning}
          title="Compile and run the current file to generate snapshots"
          onClick={() => void runProgram()}
        >
          {visualRunning ? (
            <>
              <span className="spinner" aria-hidden="true" />
              Running…
            </>
          ) : (
            "Run"
          )}
        </button>

        <button
          type="button"
          className="btn"
          disabled={!visualOpen && !active}
          title="Open the visualizer using the last run's snapshots"
          onClick={() => (visualOpen ? closeVisual() : openVisual())}
        >
          {visualOpen ? "Close Visual" : "Open Visual"}
        </button>

        <button
          type="button"
          className="btn"
          aria-pressed={documentationOpen}
          onClick={() =>
            setDocumentationOpen((open) => !open)
          }
        >
          {documentationOpen ? "Back to Workspace" : "Documentation"}
        </button>

        <button
          type="button"
          className="btn"
          onClick={() =>
            setTheme(theme === "dark" ? "light" : "dark")
          }
        >
          {theme === "dark" ? "Light" : "Dark"}
        </button>
      </header>

      {documentationOpen ? (
        <main className="body documentation-page">
          <Documentation theme={theme} />
        </main>
      ) : (
        <div className="body" ref={bodyRef}>
          <div
            className="column"
            ref={columnRef}
            style={
              visualOpen
                ? { flex: `0 0 ${(1 - visualRatio) * 100}%` }
                : undefined
            }
          >
            <Editor
              tabs={tabs}
              active={active}
              activeId={activeId}
              setActiveId={setActiveId}
              closeTab={closeTab}
              newFile={newFile}
              openFile={openFile}
              update={update}
              theme={theme}
              currentLine={currentLine}
            />

            <Splitter
              label="Resize terminal"
              onDelta={resizeTerminal}
            />

            <Terminal
              shell={shell}
              onShellChange={setShell}
              height={terminalHeight}
              theme={theme}
              outputRef={terminalOutputRef}
              startDir={folderOf(active?.path)}
            />
          </div>

          {visualOpen && (
            <>
              <Splitter
                vertical
                label="Resize visualizer"
                onDelta={resizeVisual}
              />

              <section className="visual">
                <header className="panel-header">
                  <span className="panel-title">
                    Visualizer
                    {snapshots.length > 0 && (
                      <span className="panel-meta">
                        {snapshots.length} snapshots
                      </span>
                    )}
                  </span>

                </header>

                <div className="visual-content">
                  {snapshots.length > 0 ? (
                    <JavaVisual
                      snapshots={snapshots}
                      setLine={setCurrentLine}
                    />
                  ) : (
                    <p className="visual-empty">
                      {visualRunning
                        ? "Compiling and running…"
                        : "No snapshots found. Run the program first."}
                    </p>
                  )}
                </div>
              </section>
            </>
          )}
        </div>
      )}

      {!documentationOpen && active && (
        <footer className="statusbar">
          <span className="statusbar-path">
            {active.path || "Unsaved file"}
          </span>
          <span>{active.content.split("\n").length} lines</span>
          <span>{active.dirty ? "Modified" : "Saved"}</span>
        </footer>
      )}
    </div>
  );
}