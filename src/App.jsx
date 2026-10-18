import { useCallback, useEffect, useRef, useState } from "react";

import JavaVisual from "./JavaVisual";
import Editor from "./Editor";
import Terminal from "./Terminal";
import Brand from "./Brand";
import Splitter from "./Splitter";
import Documentation from "./Documentation";
import { useTheme } from "./ThemeProvider";

import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { invoke } from "@tauri-apps/api/core";

const basename = (path) =>
  path?.split(/[\\/]/).filter(Boolean).pop() || "Untitled";

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

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
  const [snapshots, setSnapshots] = useState([]);

  const terminalOutputRef = useRef(null);
  const columnRef = useRef(null);
  const bodyRef = useRef(null);

  const active =
    tabs.find((tab) => tab.id === activeId) || tabs[0] || null;

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
              "h",
              "md",
            ],
          },
        ],
      });

      if (!path || typeof path !== "string") return;

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
          defaultPath:
            active.name === "New.java" ? "Main.java" : active.name,
        });
      }

      if (!path) return;

      await writeTextFile(path, active.content);
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

  async function runVisual() {
    if (!active) return;

    const write = (text) => terminalOutputRef.current?.(text);
    let path = active.path;

    try {
      if (!path) {
        path = await save({
          defaultPath:
            active.name === "New.java" ? "Main.java" : active.name,
        });

        if (!path) return;
      }

      if (!path.toLowerCase().endsWith(".java")) {
        write("\x1b[31mVisual mode requires a .java file.\x1b[0m");
        return;
      }

      await writeTextFile(path, active.content);
      update({ path, name: basename(path), dirty: false });

      setVisualOpen(true);
      setVisualRunning(true);
      setSnapshots([]);
      setCurrentLine(null);

      write(
        `\x1b[90m\r\n[JavaLens Visual] Compiling ${basename(path)}...\x1b[0m`
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

      if (result.success && Array.isArray(result.snapshots)) {
        setSnapshots(result.snapshots);

        write(
          `\x1b[32m[JavaLens Visual] Captured ${result.snapshots.length} snapshots; data shown in visualizer.\x1b[0m`
        );
      } else if (!result.compile_stderr) {
        write(
          "\x1b[31m[JavaLens Visual] No snapshots were captured.\x1b[0m"
        );
      }
    } catch (error) {
      console.error("Visual run failed:", error);
      write(`\x1b[31m[JavaLens Visual] ${String(error)}\x1b[0m`);
    } finally {
      setVisualRunning(false);
    }
  }

  function closeVisual() {
    setVisualOpen(false);
    setCurrentLine(null);
  }

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

        <button
          type="button"
          className="btn"
          disabled={visualRunning || (!visualOpen && !active)}
          title="Compile current Java file and open visualizer"
          onClick={() =>
            visualOpen ? closeVisual() : void runVisual()
          }
        >
          {visualRunning
            ? "Running…"
            : visualOpen
              ? "Close Visual"
              : "Visual"}
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

                  <div className="panel-actions">
                    <button
                      type="button"
                      className="btn btn-small"
                      onClick={() => void runVisual()}
                      disabled={visualRunning || !active}
                    >
                      Run again
                    </button>
                  </div>
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
                        : "No snapshot data."}
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