import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Terminal as XTerminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace';

const THEMES = {
  dark: {
    background: "#0b0b0b",
    foreground: "#e5e5e5",
    cursor: "#ef4444",
    selectionBackground: "#5a2525",
    black: "#111111",
    red: "#ff5555",
    green: "#50fa7b",
    yellow: "#f1fa8c",
    blue: "#8be9fd",
    magenta: "#ff79c6",
    cyan: "#8be9fd",
    white: "#f8f8f2",
    brightBlack: "#8a8a8a",
  },
  light: {
    background: "#ffffff",
    foreground: "#171717",
    cursor: "#dc2626",
    selectionBackground: "#fecaca",
    black: "#171717",
    red: "#b91c1c",
    green: "#15803d",
    yellow: "#a16207",
    blue: "#1d4ed8",
    magenta: "#a21caf",
    cyan: "#0e7490",
    white: "#525252",
    brightBlack: "#737373",
  },
};

// Same Tauri contract as before: start_terminal / write_terminal /
// resize_terminal / stop_terminal and the "terminal-output" event.
export default function Terminal({ shell, onShellChange, height, theme, outputRef }) {
  const hostRef = useRef(null);
  const termRef = useRef(null);
  const sessionRef = useRef(null);
  const themeRef = useRef(theme);
  const [status, setStatus] = useState("Starting terminal…");

  themeRef.current = theme;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;

    const terminal = new XTerminal({
      cursorBlink: true,
      convertEol: true,
      scrollback: 5000,
      fontSize: 13,
      fontFamily: MONO,
      theme: THEMES[themeRef.current] || THEMES.light,
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(host);
    termRef.current = terminal;

    if (outputRef) {
      outputRef.current = (message) => {
        const lines = String(message ?? "").replace(/\r?\n$/, "").split("\n");
        for (const line of lines) terminal.writeln(line);
      };
    }

    let disposed = false;
    let unlistenOutput;
    let inputDisposable;
    let resizeDisposable;

    const safeFit = () => {
      try {
        fit.fit();
      } catch {
        /* host not measurable yet */
      }
    };

    const start = async () => {
      try {
        // Listen before starting the shell so no early output is lost.
        unlistenOutput = await listen("terminal-output", (event) => {
          if (
            !disposed &&
            event.payload?.sessionId === sessionRef.current &&
            typeof event.payload?.data === "string"
          ) {
            terminal.write(event.payload.data);
          }
        });
        if (disposed) {
          unlistenOutput();
          return;
        }

        const result = await invoke("start_terminal", { shell });
        const sessionId =
          typeof result === "string"
            ? result
            : result?.sessionId ??
              result?.session_id ??
              result?.id ??
              result?.terminalId ??
              result?.terminal_id;

        if (sessionId == null || sessionId === "") {
          throw new Error(`Invalid start_terminal response: ${JSON.stringify(result)}`);
        }
        if (disposed) {
          await invoke("stop_terminal", { sessionId }).catch(() => {});
          return;
        }

        sessionRef.current = sessionId;
        const shellName =
          typeof result === "object" && result !== null
            ? result.shellName ?? result.shell_name
            : null;
        setStatus(`${shellName || shell} · persistent shell`);

        inputDisposable = terminal.onData((data) => {
          const id = sessionRef.current;
          if (!id || disposed) return;
          invoke("write_terminal", { sessionId: id, data }).catch((error) => {
            console.error("Terminal input failed:", error);
            setStatus("Terminal input failed");
          });
        });

        resizeDisposable = terminal.onResize(({ cols, rows }) => {
          const id = sessionRef.current;
          if (!id || disposed) return;
          invoke("resize_terminal", { sessionId: id, cols, rows }).catch(() => {});
        });

        requestAnimationFrame(() => {
          if (disposed) return;
          safeFit();
          const id = sessionRef.current;
          if (id) {
            invoke("resize_terminal", {
              sessionId: id,
              cols: terminal.cols,
              rows: terminal.rows,
            }).catch(() => {});
          }
        });
      } catch (error) {
        console.error("Terminal startup failed:", error);
        setStatus("Terminal failed to start");
        terminal.writeln(`\x1b[31m${String(error)}\x1b[0m`);
      }
    };
    void start();

    // Coalesce resize notifications into one fit per frame.
    let raf = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(safeFit);
    });
    observer.observe(host);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      observer.disconnect();
      unlistenOutput?.();
      inputDisposable?.dispose();
      resizeDisposable?.dispose();

      const sessionId = sessionRef.current;
      sessionRef.current = null;
      if (sessionId) {
        invoke("stop_terminal", { sessionId }).catch((error) =>
          console.error("Terminal stop failed:", error)
        );
      }
      if (outputRef) outputRef.current = null;
      terminal.dispose();
      termRef.current = null;
    };
  }, [shell, outputRef]);

  // Theme changes recolor the live terminal; they never restart the shell.
  useEffect(() => {
    if (termRef.current) termRef.current.options.theme = THEMES[theme] || THEMES.light;
  }, [theme]);

  return (
    <section className="terminal" style={{ height }}>
      <header className="panel-header">
        <span className="panel-title">Terminal</span>
        <div className="panel-actions">
          <select
            aria-label="Shell"
            value={shell}
            onChange={(e) => onShellChange(e.target.value)}
            className="select"
            title="Changing shell restarts the terminal session"
          >
            <option value="default">Default</option>
            <option value="bash">bash</option>
            <option value="zsh">zsh</option>
            <option value="sh">sh</option>
            <option value="fish">fish</option>
            <option value="powershell">PowerShell</option>
            <option value="cmd">cmd</option>
          </select>
          <button
            type="button"
            className="btn btn-small"
            onClick={() => {
              termRef.current?.clear();
              termRef.current?.focus();
            }}
          >
            Clear
          </button>
        </div>
      </header>
      <div className="terminal-host" ref={hostRef} onClick={() => termRef.current?.focus()} />
      <footer className="terminal-status">{status}</footer>
    </section>
  );
}
