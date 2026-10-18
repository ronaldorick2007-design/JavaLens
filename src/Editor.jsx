import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { highlightJava } from "./highlight";

// Layout constants shared with index.css (--lh, --pad-y, --pad-x).
const LINE_HEIGHT = 22;
const PAD_Y = 12;
const PAD_X = 16;
const INDENT = "    ";

function insertText(ta, text) {
  ta.focus();
  // execCommand keeps the native undo stack; fall back to setRangeText.
  if (!document.execCommand("insertText", false, text)) {
    ta.setRangeText(text, ta.selectionStart, ta.selectionEnd, "end");
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  }
}

function handleTab(ta, outdent) {
  const { value, selectionStart: s, selectionEnd: e } = ta;
  const multiline = value.slice(s, e).includes("\n");

  if (!outdent && !multiline) {
    insertText(ta, INDENT);
    return;
  }

  const blockStart = value.lastIndexOf("\n", s - 1) + 1;
  const block = value.slice(blockStart, e);
  const lines = block.split("\n");
  const next = lines
    .map((line) =>
      outdent ? line.replace(/^(?: {1,4}|\t)/, "") : INDENT + line
    )
    .join("\n");
  if (next === block) return;

  ta.setSelectionRange(blockStart, e);
  insertText(ta, next);
  ta.setSelectionRange(blockStart, blockStart + next.length);
}

function handleEnter(ta) {
  const { value, selectionStart: s, selectionEnd: e } = ta;
  const lineStart = value.lastIndexOf("\n", s - 1) + 1;
  const beforeCaret = value.slice(lineStart, s);
  const indent = /^[ \t]*/.exec(beforeCaret)[0];
  const opensBlock = beforeCaret.trimEnd().endsWith("{");
  const extra = opensBlock ? INDENT : "";
  const closesNext = /^[ \t]*\}/.test(value.slice(e, value.indexOf("\n", e) === -1 ? undefined : value.indexOf("\n", e)));

  if (opensBlock && closesNext) {
    insertText(ta, `\n${indent}${extra}\n${indent}`);
    const caret = s + 1 + indent.length + extra.length;
    ta.setSelectionRange(caret, caret);
  } else {
    insertText(ta, `\n${indent}${extra}`);
  }
}

export default function Editor({
  tabs,
  active,
  setActiveId,
  closeTab,
  newFile,
  openFile,
  update,
  currentLine,
}) {
  const scrollRef = useRef(null);
  const gutterRef = useRef(null);
  const taRef = useRef(null);
  const charWidth = useRef(0);

  const content = active?.content ?? "";
  const isJava = !active || /\.java$/i.test(active.name) || active.name === "New.java";

  const segments = useMemo(
    () => (isJava ? highlightJava(content) : [[null, content]]),
    [content, isJava]
  );
  const lineCount = useMemo(() => content.split("\n").length, [content]);

  // Keep the caret visible. The textarea never scrolls itself (it is sized to
  // its content inside one scroll container), so we do it explicitly.
  const revealCaret = () => {
    const ta = taRef.current;
    const sc = scrollRef.current;
    if (!ta || !sc) return;

    if (!charWidth.current) {
      const ctx = document.createElement("canvas").getContext("2d");
      ctx.font = getComputedStyle(ta).font;
      charWidth.current = ctx.measureText("M").width || 8;
    }

    const pos = ta.selectionDirection === "backward" ? ta.selectionStart : ta.selectionEnd;
    const before = ta.value.slice(0, pos);
    const line = before.split("\n").length - 1;
    const lineText = before.slice(before.lastIndexOf("\n") + 1);
    let col = 0;
    for (const ch of lineText) col = ch === "\t" ? col + 4 - (col % 4) : col + 1;

    const top = PAD_Y + line * LINE_HEIGHT;
    if (top < sc.scrollTop + LINE_HEIGHT) sc.scrollTop = Math.max(0, top - LINE_HEIGHT);
    else if (top + 2 * LINE_HEIGHT > sc.scrollTop + sc.clientHeight)
      sc.scrollTop = top + 2 * LINE_HEIGHT - sc.clientHeight;

    const gutterW = gutterRef.current?.offsetWidth ?? 0;
    const x = gutterW + PAD_X + col * charWidth.current;
    if (x < sc.scrollLeft + gutterW + 24) sc.scrollLeft = Math.max(0, x - gutterW - 48);
    else if (x + 32 > sc.scrollLeft + sc.clientWidth) sc.scrollLeft = x + 48 - sc.clientWidth;
  };

  // Jump to the line reported by the visualizer.
  useEffect(() => {
    const sc = scrollRef.current;
    if (!sc || !Number.isFinite(currentLine) || currentLine < 1) return;
    const target = PAD_Y + (currentLine - 1) * LINE_HEIGHT - sc.clientHeight / 2 + LINE_HEIGHT / 2;
    sc.scrollTop = Math.max(0, target);
  }, [currentLine, active?.id]);

  // A new tab starts at the top-left.
  useLayoutEffect(() => {
    const sc = scrollRef.current;
    if (sc) {
      sc.scrollTop = 0;
      sc.scrollLeft = 0;
    }
  }, [active?.id]);

  const onKeyDown = (event) => {
    if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
    const ta = event.currentTarget;
    if (event.key === "Tab") {
      event.preventDefault();
      handleTab(ta, event.shiftKey);
    } else if (event.key === "Enter") {
      event.preventDefault();
      handleEnter(ta);
    }
  };

  const hasLine = Number.isFinite(currentLine) && currentLine >= 1 && currentLine <= lineCount;

  return (
    <div className="editor">
      {tabs.length > 0 && (
        <div className="tabbar" role="tablist">
          {tabs.map((tab) => (
            <div
              key={tab.id}
              role="tab"
              tabIndex={0}
              aria-selected={tab.id === active?.id}
              className={`tab ${tab.id === active?.id ? "tab-active" : ""}`}
              title={tab.path || tab.name}
              onClick={() => setActiveId(tab.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setActiveId(tab.id);
                }
              }}
            >
              <span className="tab-name">{tab.name}</span>
              {tab.dirty && <span className="tab-dirty" aria-label="Unsaved changes" />}
              <button
                type="button"
                className="tab-close"
                aria-label={`Close ${tab.name}`}
                tabIndex={-1}
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(tab.id);
                }}
              >
                ×
              </button>
            </div>
          ))}
          <button type="button" className="tab-new" onClick={newFile} aria-label="New file" title="New file">
            +
          </button>
        </div>
      )}

      {active ? (
        <div className="editor-scroll" ref={scrollRef}>
          <div className="editor-body">
            <div className="gutter" ref={gutterRef} aria-hidden="true">
              {Array.from({ length: lineCount }, (_, i) => (
                <div key={i} className={currentLine === i + 1 ? "gutter-line gutter-current" : "gutter-line"}>
                  {i + 1}
                </div>
              ))}
            </div>
            <div className="code-stack">
              {hasLine && (
                <div className="current-line" style={{ top: PAD_Y + (currentLine - 1) * LINE_HEIGHT }} />
              )}
              <pre className="code-layer" aria-hidden="true">
                {segments.map(([cls, text], i) =>
                  cls ? (
                    <span key={i} className={cls}>{text}</span>
                  ) : (
                    text
                  )
                )}
                {"\n"}
              </pre>
              <textarea
                key={active.id}
                ref={taRef}
                className="code-input"
                wrap="off"
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                autoComplete="off"
                aria-label="Source code editor"
                value={content}
                onChange={(e) => update({ content: e.target.value, dirty: true })}
                onKeyDown={onKeyDown}
                onInput={revealCaret}
                onKeyUp={revealCaret}
                onSelect={revealCaret}
              />
            </div>
          </div>
        </div>
      ) : (
        <div className="empty">
          <div className="empty-actions">
            <button type="button" className="btn btn-primary" onClick={openFile}>
              Open File
            </button>
            <button type="button" className="btn" onClick={newFile}>
              New File
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
